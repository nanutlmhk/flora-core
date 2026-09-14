# รายงานปัญหา Hidro USB/Serial Stability

## 1. ชื่อปัญหา

`Hidro USB/Serial Connectivity Instability in Real OR Deployment`

## 2. สรุปปัญหา

ระหว่างการใช้งานจริงในห้องผ่าตัด พบว่า Hidro มีพฤติกรรมการเชื่อมต่อ `USB/serial` ที่ไม่เสถียรในบาง client workstation

พฤติกรรมที่พบ ได้แก่

- device status เปลี่ยนเป็น `offline` แบบสุ่ม
- บางครั้ง data transmission ยังทำงานอยู่ แม้ status จะแสดง `offline`
- บางกรณีถอด/เสียบ `USB serial adapter` ใหม่แล้วระบบกลับมาทำงานได้
- บางกรณีต้อง restart workstation จึงจะกลับมาทำงานได้
- ในบางห้อง เมื่อใช้งานไประยะหนึ่ง service อาจหยุด retrieving data ไปเลย

ปัญหานี้ไม่ได้เกิดเหมือนกันทุกห้อง แม้ใช้ Hidro version เดียวกัน

## 3. ผลกระทบต่อการใช้งาน

- ลดความมั่นใจของผู้ใช้ต่อ Hidro และ FLORA
- ทำให้เกิดความสับสนระหว่าง `status offline` กับ `actual data still flowing`
- เพิ่มความเสี่ยงต่อ workflow ระหว่างใช้งานจริง
- เพิ่มภาระ support ระหว่าง rollout
- ทำให้การขยาย deployment ไปยังหลายห้องทำได้ยากขึ้น

## 4. บริบทที่ได้รับผลกระทบ

environment โดยทั่วไป:

- Windows client workstation ใน OR
- `USB-to-serial adapters`
- serial-connected medical devices
- Hidro service ทำงาน locally
- FLORA ดึงข้อมูลจาก Hidro local API

บริบทการใช้งานจริงที่เกี่ยวข้อง เช่น

- `OR 508`
- `OR 701`

และพฤติกรรมอาจแตกต่างกันระหว่างห้อง

## 5. อาการที่พบ

### กลุ่มอาการ A: Status inconsistency

- tray/UI อาจแสดงว่า device `offline`
- แต่ actual device data อาจยังคงเข้าสู่ Hidro database
- ผู้ใช้ไม่สามารถแยกได้ง่ายว่าเป็นปัญหาที่ UI, transport layer หรือ actual data flow

### กลุ่มอาการ B: Recovery inconsistency

- unplug/replug บางครั้งช่วยได้
- manual reconnect บางครั้งช่วยได้
- hard reset บางครั้งช่วยได้
- บางกรณีต้อง restart Windows ทั้งเครื่อง

### กลุ่มอาการ C: Long-running instability

- service เริ่มต้นทำงานได้ปกติ
- device เชื่อมต่อได้ปกติ
- เมื่อใช้งานไปสักระยะ data path อาจหยุดทำงาน
- ปัญหาอาจกลับมาอีกโดยไม่มี trigger เดียวที่ชัดเจน

## 6. สิ่งที่ได้ลองแก้ไขไปแล้ว

รายการต่อไปนี้ถือว่าเป็นสิ่งที่ได้ลองทำไปแล้ว และไม่ควรถูกเสนอซ้ำในฐานะคำแนะนำเบื้องต้นอีก

### ฝั่ง software / Hidro

- reconnect / retry logic
- improved serial recovery behavior
- diagnostics และ logging
- status UX improvement
- separation between service reachability และ device online state
- hard reset COM port workflow
- COM scanning / auto-detect logic
- selected COM port control
- transport/data diagnostics ใน tray และ service

### ฝั่ง environment / workstation

- clean / fresh Windows 11 installation
- disable USB power-saving options
- disable power saver behavior on USB ports
- retest ในหลายห้อง / หลาย client machine

### ฝั่ง physical / support

- unplug และ replug USB adapter
- restart workstation
- reconfiguration และ retesting หลายรอบระหว่าง support หน้างานจริง

## 7. ประวัติการปรับปรุงเชิง engineering ของ Hidro

current codebase มีการพยายามแก้ปัญหาด้านนี้ไปแล้วหลายรอบ เช่น

- serial recovery improvements
- diagnostics logging
- tray status reliability improvements
- hard reset COM port support
- auto-reconnect และ retry controls

ดังนั้นปัญหานี้ไม่ควรถูกมองว่าเป็นเพียง “ยังไม่มี reconnect logic”

## 8. Timeline ของ engineering attempts

ปัญหานี้ควรถูกมองในบริบทของการปรับปรุงเชิง engineering ต่อเนื่องหลายรอบ ไม่ใช่ bug เดี่ยวที่ยังไม่ได้แตะ

### ช่วงวางรากฐาน

- `2a190a7` Initial commit — Hidro extracted from flora-alpha
- `6ddfc8a` Add README with full project overview and API reference

### ช่วงเพิ่ม visibility และ diagnostics

- `d8f32b8` Add Diagnostics tab with live parameter feed per device
- `01e7da2` Reduce diagnostics refresh interval to 1 minute

### ช่วงขยาย device support และ serial protocol

- `7b3e77a` Add GE Bx50 and GE Aisys CS2 serial drivers (S/5 DRI protocol)
- `25e9a4c` Fix DRI levels and baud rate for CARESCAPE devices

### ช่วง hardening ด้าน recovery และ status

- `0e72f76` Improve Hidro serial recovery and simplify release packaging
- `3df9a1d` Improve Hidro status UX and recovery controls
- `cc085b7` Trust fresh device data in Hidro status UI

### current diagnostics / reliability milestone

- `e327d59` Bump Hidro version to 1.2.1
- `dae0910` Hidro 1.2.2 diagnostics and status reliability

### ความหมายของ timeline นี้

timeline นี้แสดงให้เห็นว่า team ได้ผ่านการปรับปรุงมาแล้วหลายชั้น ได้แก่

- visibility improvements
- diagnostics improvements
- driver/protocol corrections
- serial recovery improvements
- status interpretation improvements

ดังนั้นปัญหาที่ยังเหลืออยู่ควรถูกมองว่าเป็น deeper reliability problem ไม่ใช่เพียงการขาด basic debugging effort

## 9. การตีความปัญหาในปัจจุบัน

จากพฤติกรรมที่เกิดขึ้นซ้ำในงานจริง และจาก mitigation ที่ได้ลองไปแล้ว ปัญหาที่เหลืออยู่มีแนวโน้มจะอยู่ลึกกว่าชั้น clinical application ปกติ

layer ที่น่าจะมีส่วนเกี่ยวข้องมากที่สุด ได้แก่

1. Windows `USB / serial driver` instability
2. behavior ของ `USB-to-serial adapter` หรือ chipset ที่ไม่สม่ำเสมอ
3. workstation-specific environment residue หรือ software conflict
4. `COM handle / port rebind` edge cases
5. long-running `serial library` หรือ runtime edge cases ใน deployment จริง

## 10. สิ่งที่ปัญหานี้น่าจะไม่ใช่

ปัญหานี้น่าจะไม่สามารถอธิบายได้ด้วยสาเหตุง่าย ๆ เช่น

- ordinary frontend bug
- simple FLORA workflow problem
- one missing retry statement
- one missing reconnect button

## 11. Current Root-Cause Position

ข้อสรุปเชิง working position ในปัจจุบันคือ

> เราได้ลอง application-level และ workstation-level mitigations ที่สมเหตุสมผลไปแล้วหลายอย่าง  
> แต่ความไม่เสถียรที่ยังเหลืออยู่มีแนวโน้มเป็นปัญหาใน transport layer หรือ environment layer มากกว่าจะเป็น bedside UI หรือ documentation bug ธรรมดา

## 12. แนวทาง next step ที่แนะนำ

แนวทางต่อไปควรเน้นที่การแยกปัญหาและลดความไม่แน่นอน ไม่ใช่การ workaround แบบเดิมซ้ำไปเรื่อย ๆ

### Option A: Environment isolation

- standardize workstation image
- standardize adapter chipset/model
- verify ว่ายังมี legacy environment conflict หรือไม่
- isolate ห้องที่มีปัญหาเทียบกับห้องที่ใช้งานได้ดี

### Option B: Connectivity middleware isolation

- สร้าง dedicated middleware/service layer ที่โฟกัสเฉพาะ `USB/serial connectivity reliability`
- keep connection alive
- auto-recover transport safely
- expose stable downstream output ให้ Hidro/FLORA ใช้งานต่อ
- หลีกเลี่ยงการไปแก้ FLORA clinical workflow layer โดยตรง

### Option C: Appliance / Hidro Box direction

- ย้าย serial/device connectivity ออกจาก Windows client PC ทั่วไป
- ใช้ dedicated single-board / embedded box สำหรับ transport layer
- ให้ workstation ทำหน้าที่ consume data path ที่ผ่านการ stabilize แล้ว

## 13. ข้อเสนอเชิงปฏิบัติ

หากจะมี external technical help เข้ามาช่วย ขอบเขตที่เหมาะสมที่สุดคือ

- `USB/serial transport reliability`
- connectivity middleware
- appliance/bridge solution

ขอบเขตที่เสี่ยงที่สุดคือ

- direct uncontrolled modification ของ FLORA/Hidro application core โดยไม่มี boundary หรือ ownership ที่ชัดเจน

## 14. ข้อมูลที่ควรเก็บเมื่อเกิด incident ครั้งถัดไป

ทุก future incident ควรเก็บข้อมูลอย่างน้อยดังนี้

- room number
- workstation name / IP
- Windows image / install age
- USB adapter model / chipset / serial number ถ้าทราบ
- device model
- configured COM port
- Hidro version
- status ว่าแสดง `offline` หรือไม่
- data จริงยังไหลอยู่หรือไม่
- unplug/replug แล้วหายหรือไม่
- hard reset แล้วหายหรือไม่
- restart workstation แล้วหายหรือไม่
- runtime ก่อนเกิดปัญหาโดยประมาณ
- diagnostics log reference

## 15. สรุป

ปัญหานี้ได้ก้าวพ้นระดับ basic app-level troubleshooting ไปแล้ว

หลักฐานที่มีอยู่ในตอนนี้สนับสนุนข้อสรุปว่า

- software mitigations หลายอย่างได้ถูก implement ไปแล้ว
- clean Windows และการปิด USB power-saving ได้ถูกลองแล้ว
- ปัญหายังคงเกิดแบบ unpredictable ใน deployment จริง

ดังนั้น phase ถัดไปควรเน้นที่

- transport-layer reliability
- environment standardization
- หรือ architecture isolation เช่น dedicated connectivity middleware / Hidro Box approach
