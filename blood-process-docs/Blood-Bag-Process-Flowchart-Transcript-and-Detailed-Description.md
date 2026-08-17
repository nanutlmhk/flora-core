# Blood Bag Process Flowchart
## Easy Reading Guide

This document helps explain the attached **Blood Bag Process Flowchart** in simple terms.

The flowchart shows how a blood bag is handled during an operation, and how **AIDAS** helps the team record each important step.

---

## 1. What the Three Columns Mean

The flowchart is divided into three columns:

| Column | Meaning |
| --- | --- |
| **OR Workflow** | What doctors and nurses do in the operating room |
| **AIDAS** | What the AIDAS system shows or records |
| **HIS and Blood Bank** | Where blood bags are prepared and their information is provided |

Simply speaking:

- The **Blood Bank** prepares the blood bags.
- The **OR team** checks and gives the blood to the patient.
- **AIDAS** helps show the bag information and keep a record of what happened.

---

## 2. Beginning of the Process

When the operation starts, the OR team opens the **Blood Board** in AIDAS.

AIDAS then gets the available blood bag information from HIS/Blood Bank and shows the list on screen.

This allows the team to see which blood bags are available for the patient.

```text
Start Case
  -> Open Blood Board
  -> AIDAS gets blood bag list from HIS
  -> AIDAS shows available bags
```

---

## 3. Selecting and Checking a Blood Bag

Before giving blood to the patient, the OR team selects or scans the blood bag.

AIDAS helps compare the bag information with the information received from HIS.

The OR team then performs the bedside check and confirms that the blood bag is correct for the patient.

After confirmation, AIDAS records that the verification was completed.

```text
Review Bag List
  -> Scan or Select Bag
  -> AIDAS matches the bag information
  -> Staff performs bedside check
  -> Verification is recorded
```

**Important:** AIDAS supports the checking process, but the doctor or nurse must still perform the actual patient and blood bag verification.

---

## 4. Warming the Blood Bag, If Needed

Some blood bags may need warming before they are given to the patient.

If warming is required, the OR team warms the bag and AIDAS records that step.

If warming is not required, the team may continue directly to giving the blood.

```text
Need Warming?
  -> Yes: Warm Bag, then record warming in AIDAS
  -> No: Continue to giving blood
```

---

## 5. Giving Blood to the Patient

When transfusion begins, the OR team starts giving the blood product to the patient.

AIDAS records the start time and the amount of blood product given.

```text
Start Giving
  -> AIDAS records start time and amount
```

This helps make the patient record clearer and allows the team to review blood usage later.

---

## 6. What Happens After Blood Is Given

There are two possible outcomes shown in the flowchart.

### Normal Completion

If the blood bag is given successfully, the bag is marked as completed.

### Stop or Reaction

If the blood must be stopped early, or if the patient has a suspected reaction, the team handles the clinical situation and records it in AIDAS.

```text
Outcome
  -> Completed: Complete the bag record
  -> Stopped or Reaction: Record the event and relevant details
```

AIDAS then updates the Blood Board so the team can see the current status of the bag.

---

## 7. If More Blood Bags Are Needed

During an operation, the patient may require more blood products.

If more bags are needed:

1. The Blood Bank prepares or releases additional bags.
2. New bag information becomes available in HIS.
3. AIDAS refreshes the list.
4. The new bags are added to the Blood Board.
5. The OR team can continue the same checking and recording process for each new bag.

```text
More Bags Needed?
  -> Yes: Blood Bank prepares more bags
          -> AIDAS refreshes the list
          -> New bags are shown
          -> Continue the process
```

The information already recorded for earlier bags remains in the case record.

---

## 8. Ending the Process

When no more blood bags are required, the operation continues toward completion.

At the end of the case, AIDAS prepares a summary of the blood bag process.

The summary can show:

- which blood products were used
- which blood bags were handled
- when transfusion started
- how much blood was given
- whether a bag was completed or stopped
- whether any reaction was recorded

```text
No More Bags Needed
  -> End Case
  -> AIDAS generates summary
```

---

## 9. Simple Example

For example, a patient needs two blood bags during an operation.

| Step | What Happens |
| --- | --- |
| 1 | AIDAS shows two available blood bags from HIS |
| 2 | Staff select and check the first bag |
| 3 | The first bag is warmed and then given to the patient |
| 4 | AIDAS records that the first bag was completed |
| 5 | Staff select and check the second bag |
| 6 | The second bag is given without warming |
| 7 | AIDAS records that the second bag was completed |
| 8 | At the end of the case, AIDAS shows a summary of both bags |

If an additional bag is needed during the operation, AIDAS can refresh the list and show the new bag when it becomes available from HIS.

---

## 10. Main Message

The flowchart describes a simple process:

```text
Blood Bank prepares the blood bags
  -> AIDAS shows the available bags
  -> OR staff check the correct bag for the patient
  -> Blood is warmed if needed
  -> Blood is given to the patient
  -> AIDAS records the result
  -> Additional bags can be added if needed
  -> A summary is available at the end of the case
```

AIDAS is designed to make blood bag tracking and documentation easier and clearer while the clinical team continues to perform the required patient safety checks.
