"""Map Flora's existing local clinical masters to appropriate standards.

The local concept remains authoritative. This script only adds reviewed or
exactly-resolved codings; it never guesses a diagnosis/procedure mapping.
Medication ingredients are resolved through the public NLM RxNorm API.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg
from psycopg.rows import dict_row

SYSTEMS = {
    "SNOMED_CT": "http://snomed.info/sct",
    "LOINC": "http://loinc.org",
    "RXNORM": "http://www.nlm.nih.gov/research/umls/rxnorm",
    "ATC": "http://www.whocc.no/atc",
    "UCUM": "http://unitsofmeasure.org",
}

# Only direct, unambiguous observation meanings are curated here. Ventilator
# settings without an exact LOINC are deliberately left with UCUM only.
LOINC = {
    "hr": ("8867-4", "Heart rate"),
    "pr": ("8867-4", "Heart rate"),
    "spo2": ("59408-5", "Oxygen saturation in Arterial blood by Pulse oximetry"),
    "rr": ("9279-1", "Respiratory rate"),
    "temperature": ("8310-5", "Body temperature"),
    "nibp_sys": ("8480-6", "Systolic blood pressure"),
    "nibp_dia": ("8462-4", "Diastolic blood pressure"),
    "nibp_map": ("8478-0", "Mean blood pressure"),
    "art_sys": ("8480-6", "Systolic blood pressure"),
    "art_dia": ("8462-4", "Diastolic blood pressure"),
    "art_map": ("8478-0", "Mean blood pressure"),
    "cvp": ("60985-9", "Central venous pressure (CVP)"),
    "et_co2": ("19889-5", "Carbon dioxide gas [Partial pressure] in Exhaled gas --at end expiration"),
    "urine": ("9187-6", "Urine output"),
    "bloodLoss": ("81661-1", "Blood loss [Volume] Measured"),
    "fio2": ("3150-0", "Inhaled oxygen concentration"),
    "fio2_meas": ("3150-0", "Inhaled oxygen concentration"),
    "tidal_volume_exp": ("76007-4", "Tidal volume expired Respiratory system airway --on ventilator"),
    "set_tidal_volume": ("20112-9", "Tidal volume setting Ventilator"),
    "peep_total": ("76248-4", "PEEP Respiratory system --on ventilator"),
    "set_peep": ("20077-4", "Positive end expiratory pressure setting Ventilator"),
    "flow_o2": ("3151-8", "Inhaled oxygen flow rate"),
}

# Product concepts, not transfusion procedure concepts.
SNOMED_BLOOD_PRODUCTS = {
    "cryoprecipitate": ("256401009", "Cryoprecipitate (product)"),
    "freshFrozenPlasma": ("346447007", "Fresh frozen plasma (product)"),
    "packedRedCell": ("431069006", "Packed red blood cells (product)"),
    "wholeBlood": ("420135007", "Whole blood (substance)"),
}

MEDICATION_ALIASES = {
    "paracetamol": "acetaminophen",
    "pethidine": "meperidine",
    "ddavp": "desmopressin",
    "duratocin": "carbetocin",
    "isordil": "isosorbide dinitrate",
    "ventolin": "albuterol",
    "mgso4": "magnesium sulfate",
    "nahco3": "sodium bicarbonate",
    "emla": "lidocaine / prilocaine",
    "ultracet": "tramadol / acetaminophen",
    "amoxicillin/clavulanate": "amoxicillin / clavulanate",
    "cefoperazone/sulbactam": "cefoperazone / sulbactam",
    "piperacillin/tazobactam": "piperacillin / tazobactam",
    "sulbactam/ampicillin": "ampicillin / sulbactam",
    "lidocaine + adrenaline": "lidocaine / epinephrine",
    "penicillin g": "benzylpenicillin",
    "ertapenem na": "ertapenem",
    "nacl": "sodium chloride",
    "d/w": "glucose",
    "d/n/2": "glucose / sodium chloride",
    "d/n/3": "glucose / sodium chloride",
    "d/n/4": "glucose / sodium chloride",
    "d/n/5": "glucose / sodium chloride",
    "d/nss": "glucose / sodium chloride",
    "albumin": "albumin human",
    "dextran": "dextran 40",
    "hemohes": "hetastarch",
    "lrs": "lactated ringer's",
    "volulyte": "hydroxyethyl starch",
    "voluven": "hydroxyethyl starch",
    "tetraspan": "hydroxyethyl starch",
}

UCUM_NORMALIZATION = {
    "ml": "mL",
    "mcg": "ug",
    "units": "[IU]",
    "munits": "10*6.[IU]",
}


def json_get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "Flora-terminology-mapper/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def normalize_medication(name: str) -> str:
    value = re.sub(r"^\s*\d+(?:\.\d+)?%\s*", "", name.strip(), flags=re.I)
    value = re.sub(r"\s+(spray|airway|oral|suppository|others|steroid|anti[- ]?arrhythmia|analgesic|nsaid|hyperbaric|isobaric)\s*$", "", value, flags=re.I)
    value = " ".join(value.split()).lower()
    return MEDICATION_ALIASES.get(value, value)


def rxnorm_mapping(row: dict, version: str) -> tuple[int, list[tuple[str, str, str]]] | None:
    term = normalize_medication(row["local_name"])
    try:
        query = urllib.parse.urlencode({"name": term, "search": 2})
        ids = json_get(f"https://rxnav.nlm.nih.gov/REST/rxcui.json?{query}").get("idGroup", {}).get("rxnormId") or []
        if not ids:
            return None
        rxcui = ids[0]
        properties = json_get(f"https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/properties.json").get("properties") or {}
        display = properties.get("name") or term
        all_properties = json_get(f"https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/allProperties.json?prop=ALL")
        values = all_properties.get("propConceptGroup", {}).get("propConcept") or []
        atc_codes = sorted({item["propValue"] for item in values if item.get("propName") == "ATC"}, key=lambda value: (-len(value), value))
        mappings = [("RXNORM", rxcui, display)]
        if atc_codes:
            mappings.append(("ATC", atc_codes[0], display))
        return row["id"], mappings
    except Exception as cause:
        print(f"WARN medication {row['local_id']}: {cause}")
        return None


def upsert(database, concept_id: int, system: str, code: str, display: str, version: str, entry_id: int | None = None):
    now = int(time.time() * 1000)
    database.execute(
        """INSERT INTO clinical_concept_coding(concept_id,system_key,system_uri,code,display,version,is_preferred,terminology_entry_id,created_at,updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,1,%s,%s,%s)
           ON CONFLICT(concept_id,system_key,code) DO UPDATE SET display=excluded.display,version=excluded.version,
             terminology_entry_id=coalesce(excluded.terminology_entry_id,clinical_concept_coding.terminology_entry_id),
             is_preferred=1,updated_at=excluded.updated_at""",
        (concept_id, system, SYSTEMS[system], code, display, version, entry_id, now, now),
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.getenv("FLORA_DATABASE_URL"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.database_url:
        raise SystemExit("FLORA_DATABASE_URL or --database-url is required")

    rxnorm_version = json_get("https://rxnav.nlm.nih.gov/REST/version.json").get("version", "current")
    with psycopg.connect(args.database_url, row_factory=dict_row) as database:
        concepts = database.execute("SELECT id,domain,local_id,local_name FROM clinical_concept WHERE is_active=1 ORDER BY domain,id").fetchall()
        existing = database.execute("SELECT concept_id,system_key FROM clinical_concept_coding").fetchall()
        mapped = {row["concept_id"] for row in existing}
        semantic_mapped = {row["concept_id"] for row in existing if row["system_key"] != "UCUM"}
        rxnorm_ids = {row["concept_id"] for row in existing if row["system_key"] == "RXNORM"}
        medication_rows = [row for row in concepts if row["domain"] in {"medication", "fluid"} and row["id"] not in rxnorm_ids]
        resolved = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(rxnorm_mapping, row, rxnorm_version) for row in medication_rows]
            for future in as_completed(futures):
                result = future.result()
                if result:
                    resolved.append(result)

        with database.transaction():
            for row in concepts:
                if row["domain"] in {"observation", "output"} and row["local_id"] in LOINC:
                    code, display = LOINC[row["local_id"]]
                    upsert(database, row["id"], "LOINC", code, display, "2.82")
                    mapped.add(row["id"])
                    semantic_mapped.add(row["id"])
                if row["domain"] == "blood_product" and row["local_id"] in SNOMED_BLOOD_PRODUCTS:
                    code, display = SNOMED_BLOOD_PRODUCTS[row["local_id"]]
                    upsert(database, row["id"], "SNOMED_CT", code, display, "International")
                    mapped.add(row["id"])
                    semantic_mapped.add(row["id"])

            # Attach each operational concept's configured unit as a UCUM coding.
            units = database.execute(
                """SELECT concept.id,coalesce(parameter.unit,item.default_unit) AS unit
                   FROM clinical_concept concept
                   LEFT JOIN clinical_parameter_master parameter ON parameter.concept_id=concept.id
                   LEFT JOIN io_item_master item ON item.concept_id=concept.id
                   WHERE concept.is_active=1 AND coalesce(parameter.unit,item.default_unit,'')<>''"""
            ).fetchall()
            database.execute("DELETE FROM clinical_concept_coding WHERE system_key='UCUM'")
            for unit in units:
                unit_code = UCUM_NORMALIZATION.get(unit["unit"].lower(), unit["unit"])
                entry = database.execute(
                    """SELECT entry.id,entry.display,release.version FROM terminology_entry entry
                       JOIN terminology_release release ON release.id=entry.release_id
                       WHERE release.system_key='UCUM' AND release.status='active' AND entry.code=%s LIMIT 1""",
                    (unit_code,),
                ).fetchone()
                upsert(database, unit["id"], "UCUM", unit_code, entry["display"] if entry else unit_code, entry["version"] if entry else "2.2", entry["id"] if entry else None)
                mapped.add(unit["id"])

            for concept_id, mappings in resolved:
                for system, code, display in mappings:
                    upsert(database, concept_id, system, code, display, rxnorm_version)
                mapped.add(concept_id)
                semantic_mapped.add(concept_id)
            if args.dry_run:
                database.rollback()

        unresolved = [row for row in concepts if row["id"] not in semantic_mapped]
        print(f"Added at least one standard coding to {len(mapped)} of {len(concepts)} active local concepts.")
        print(f"Mapped clinical meaning for {len(semantic_mapped)} concepts; {len(unresolved)} still require manual meaning review (a UCUM unit alone is not counted as a semantic mapping).")
        counts = database.execute("SELECT system_key,count(*) AS count FROM clinical_concept_coding GROUP BY system_key ORDER BY system_key").fetchall()
        print("Codings: " + ", ".join(f"{row['system_key']}={row['count']}" for row in counts))
        if unresolved:
            print("Unresolved: " + ", ".join(f"{row['domain']}:{row['local_id']}" for row in unresolved))


if __name__ == "__main__":
    main()
