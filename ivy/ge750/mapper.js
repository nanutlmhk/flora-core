// measured = object from parseVTD()
function mapMeasured(measured) {
  return {
    tidal_volume_exp:     measured.tidal_volume_exp,
    minute_volume:        measured.minute_volume,
    resp_rate:            measured.resp_rate,
    fio2:                 measured.fio2,
    airway_pressure_peak: measured.airway_pressure_peak,
    airway_pressure_plat: measured.airway_pressure_plat,
    airway_pressure_mean: measured.airway_pressure_mean,
    
    // Extended fields
    mv_spont:             measured.mv_spont,
    rr_spont:             measured.rr_spont,
    peep_intrinsic:       measured.peep_intrinsic,
    compliance:           measured.compliance,
    peep_extrinsic:       measured.peep_extrinsic,
    peep_total:           measured.peep_total,

    // MGAS fields
    fio2_meas:            measured.fio2_meas,
    et_o2:                measured.et_o2,
    fi_co2:               measured.fi_co2,
    et_co2:               measured.et_co2,
    fi_agent:             measured.fi_agent,
    et_agent:             measured.et_agent,
    agent_id:             measured.agent_id,
    fi_n2o:               measured.fi_n2o,
    et_n2o:               measured.et_n2o,
    mac:                  measured.mac,

    // Gas flow fields
    flow_o2:              measured.flow_o2,
    flow_n2o:             measured.flow_n2o,
    flow_air:             measured.flow_air,
  };
}

// settings = object from parseVTQ()
function mapSettings(settings) {
  return {
    vent_mode:      settings.vent_mode,
    tv_set:         settings.tv_set,
    rr_set:         settings.rr_set,
    ie_ratio:       settings.ie_ratio,
    peep_set:       settings.peep_set,
    peak_limit:     settings.peak_limit,
    insp_pres_set:  settings.insp_pres_set,
    fio2_set:       settings.fio2_set,
    fgf_total:      settings.fgf_total,
    psupp:          settings.psupp,
    flow_trigger:   settings.flow_trigger,
    end_flow:       settings.end_flow,
    t_insp_set:     settings.t_insp_set,
  };
}

module.exports = { mapMeasured, mapSettings };
