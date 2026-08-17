# AIDAS Architecture and Technical Brief (Thai Version)

เอกสารฉบับนี้จัดทำขึ้นเพื่อใช้เป็นข้อมูลสนับสนุนวิทยากรสำหรับการประชุมคณะกรรมการ RCAT

เอกสารนี้อธิบายโครงสร้างทางเทคนิคของ AIDAS ด้วยภาษาไทย โดยคงคำ technical สำคัญไว้เป็นภาษา English เพื่อให้สื่อความหมายได้ตรงและนำไปใช้พูดคุยต่อกับฝ่าย IT หรือผู้เกี่ยวข้องได้ง่าย

## 1. AIDAS คืออะไร

AIDAS เป็นระบบ anesthesia information and documentation system ที่ออกแบบมาเพื่อสนับสนุนการบันทึกข้อมูลวิสัญญีระหว่างผ่าตัดตาม real clinical workflow

หน้าที่หลักของ AIDAS คือรวมข้อมูลสำคัญของเคสวิสัญญีไว้ในระบบเดียว ได้แก่

- anesthesia case identification
- vital sign capture
- anesthetic agent capture
- drug and fluid documentation
- blood product documentation
- clinical forms
- staff assignment
- printable anesthesia report generation

กล่าวอย่างง่าย AIDAS คือ digital anesthesia record platform ที่ยึด “anesthesia case” เป็นศูนย์กลาง

## 2. แนวคิดหลักในการออกแบบ

โครงสร้างทางเทคนิคของ AIDAS ยึดตามหลักปฏิบัติที่สำคัญไม่กี่ข้อ แต่มีความหมายมากในงานจริง

### 2.1 Local-first

AIDAS ถูกออกแบบให้ทำงานบน workstation ภายในห้องผ่าตัด

ความหมายคือ

- active case ยังดำเนินต่อได้แม้ hospital network integration จะใช้งานไม่ได้ชั่วคราว
- anesthesia record ไม่ต้องพึ่ง internet connection ตลอดเวลา
- bedside workflow ไม่ถูกหยุดเพราะ central server มีปัญหา

สำหรับ operating room สิ่งสำคัญที่สุดคือความเชื่อถือได้ของการบันทึกข้อมูล มากกว่าความสวยงามของ architecture

### 2.2 Case-centered

ข้อมูลสำคัญทุกอย่างถูกผูกอยู่กับ anesthesia case เดียวกัน เช่น

- patient identifiers
- vital sign timeline
- agent timeline
- medication and fluid records
- blood product records
- events and notes
- forms
- staff
- final report

แนวคิดนี้ช่วยให้ AIDAS ถูกมองและทบทวนได้ง่ายในมุม clinical review และตรวจสอบย้อนหลังได้ง่ายในมุม technical audit

### 2.3 Manual และ automatic documentation ต้องอยู่ร่วมกันได้

AIDAS ไม่ได้ตั้งอยู่บนสมมติฐานว่า ทุกข้อมูลต้องถูกดึงอัตโนมัติทั้งหมด

ระบบจึงรองรับทั้ง

- direct manual entry
- device-assisted capture ผ่าน Hidro
- mixed workflow ภายในเคสเดียวกัน

เหตุผลคือ real operating room workflow มีความหลากหลายจริง บางห้องมี device integration, บางเคสต้องแก้ไขด้วยมือ, และบางโรงพยาบาลมี integration เพียงบางส่วน

### 2.4 Fast clinical feedback loop

AIDAS ถูกพัฒนาให้ feedback จาก user ในเคสจริง สามารถถูกเปลี่ยนเป็น software improvement ได้ค่อนข้างเร็ว

นี่ไม่ใช่แค่ workflow principle แต่เป็น architectural principle ด้วย เพราะ codebase ถูกจัดให้เปลี่ยน form, timeline behavior, report output, และ local workflow ได้โดยไม่ต้องรอ vendor cycle ขนาดใหญ่

## 3. High-level architecture

ในมุมกว้าง AIDAS desktop ปัจจุบันประกอบด้วย 4 ชั้นหลัก

### 3.1 User interface layer

ส่วน user interface พัฒนาด้วย

- React
- TypeScript
- Vite

layer นี้เป็นส่วนที่ผู้ใช้เห็นและใช้งาน เช่น

- chart view
- fluid and medication view
- diagnosis and procedure view
- form view
- staff view
- patient view
- report view
- management view
- history view

### 3.2 Desktop shell

ตัว desktop container ใช้

- Electron

Electron มีหน้าที่

- ทำให้ AIDAS รันเป็น Windows desktop application
- เปิด frontend ใน desktop environment ที่ควบคุมได้
- launch backend ไปพร้อมกับ application
- รองรับการ build เป็น Windows installer
- รองรับ workflow สำหรับ PDF report generation

### 3.3 Backend application layer

backend พัฒนาด้วย

- Node.js
- Express

layer นี้รับผิดชอบงานสำคัญ เช่น

- case APIs
- event APIs
- medication and fluid APIs
- form APIs
- HIS-related APIs
- report data assembly
- minute writer control
- authentication routes

### 3.4 Local database layer

ฐานข้อมูล local ที่ใช้คือ

- SQLite
- ใช้งานผ่าน `better-sqlite3`

ฐานข้อมูลนี้เก็บข้อมูล เช่น

- cases
- users
- staff assignments
- allergies
- clinical forms
- timeline minutes
- events
- medication and fluid runs
- blood product records
- master data

## 4. บทบาทของ Hidro ใน external integration

Hidro เป็น device-integration companion service ที่ AIDAS ใช้ร่วมด้วย

หน้าที่ของ Hidro แตกต่างจาก AIDAS อย่างชัดเจน

- Hidro รับข้อมูลจากอุปกรณ์และ normalize ข้อมูล
- AIDAS รับผิดชอบ anesthesia case และ clinical workflow

ในเชิงปฏิบัติ

- monitor และ machine data เข้ามาผ่าน Hidro
- AIDAS อ่าน observation ที่ได้จาก Hidro
- `minute writer` แปลง observation เหล่านั้นให้กลายเป็น minute-level record ของ active case

ข้อดีของการแยกส่วนเช่นนี้คือ

- device integration เปลี่ยนบ่อยกว่ารูปแบบ clinical documentation
- vendor-specific parameter mapping อยู่ใน integration layer ได้
- AIDAS สามารถโฟกัสกับ anesthesia record ได้ชัดเจนกว่า

## 5. Minute writer และ timeline model

หนึ่งใน component ที่สำคัญมากของ AIDAS คือ `minute writer`

หน้าที่ของมันคือดึง observation ล่าสุดจาก Hidro แล้วเขียนข้อมูลแบบ minute-level ลง local database ของแต่ละเคส

### 5.1 Current behavior

จาก codebase ปัจจุบัน

- default poll interval คือ 1 second
- fetch timeout คือ 5 seconds
- bulk catch-up จะทำงานเมื่อระบบตามหลังเกิน 5 minutes

สิ่งนี้ไม่ได้หมายความว่า AIDAS เป็น real-time waveform monitor

ความหมายที่ถูกต้องคือ

- AIDAS ตรวจสอบ observation ใหม่อย่างต่อเนื่อง
- แปลงข้อมูลให้เป็น structured minute record
- ถ้าระบบตามหลังชั่วคราว จะมี backfill เพื่อ recover โดยปลอดภัย

### 5.2 Clinical meaning

แนวคิดนี้สอดคล้องกับความจริงในห้องผ่าตัดว่า

- user ไม่ได้มองจอทุกวินาที
- แต่ documentation ต้องไม่หลุดจากเคส
- temporary delay ควรถูก recover ได้ แทนที่จะทำให้ minute data หายถาวร

## 6. Data model overview

โครงสร้างข้อมูลหลักของ AIDAS สามารถอธิบายเป็นหลายกลุ่ม

### 6.1 Case table

แต่ละ case เก็บข้อมูล เช่น

- case identifier
- HN
- start time
- device capture start time
- discharge time
- archive time
- status

case status ปัจจุบันเคลื่อนผ่านได้ตามลำดับ

- active
- discharged
- archived

### 6.2 Timeline minute table

table นี้เก็บ structured vital และ device-derived minute data ของแต่ละ case

นี่คือแหล่งข้อมูลหลักสำหรับ

- time chart display
- report chart generation
- printed anesthesia timeline

### 6.3 Event table

event ใช้สำหรับ clinical moment ที่สำคัญ เช่น

- start anesthesia
- start surgery
- time out
- induction
- blood product workflow events
- notes

เหตุผลที่ event สำคัญ เพราะหลายช่วงเวลาที่มีความหมายทางคลินิก ไม่ได้อยู่ในรูปตัวเลข vital sign อย่างเดียว

### 6.4 Medication และ fluid tables

AIDAS แยกข้อมูลเป็น

- one-time entry เช่น bolus หรือ output event
- running entry เช่น drip

การแยกแบบนี้ช่วยให้ระบบรองรับได้ทั้ง

- bolus documentation
- drip start และ stop
- rate changes
- fluid balance calculation
- report rendering ของ continuous line

### 6.5 Form data

form data ถูกเก็บในลักษณะ structured key-value เพื่อให้ปรับแก้ได้ตาม workflow ที่เปลี่ยนไป

แนวทางนี้ช่วยรองรับการปรับปรุงล่าสุด เช่น

- PNB restoration
- merged line workflow
- multiple IV lines
- arterial line details
- central line details
- expanded extubation information

## 7. โครงสร้าง line workflow

ทิศทางของ line form ปัจจุบันเกิดจาก feedback จาก real cases

แทนที่จะแยก line ตามมุมมองเชิง technical มากเกินไป AIDAS ปัจจุบันจัดทุกอย่างไว้ภายใต้ Line tab เดียว โดยแยกเป็น 3 section

- IV line
- arterial line
- central line

แนวทางนี้สอดคล้องกับวิธีคิดของ clinician มากกว่า เพราะในทางปฏิบัติทั้งหมดคือ “line” แต่แต่ละชนิดต้องการระดับรายละเอียดไม่เท่ากัน

ในเชิง technical ระบบยังสามารถเก็บรายละเอียดของ arterial line และ central line ได้มากกว่า IV line โดยไม่ทำให้ routine IV workflow ยุ่งเกินไป

## 8. ทิศทางของ blood product architecture

blood product workflow มีลักษณะทางเทคนิคต่างจาก fluid entry ทั่วไป

เหตุผลคือ blood documentation มี 2 บทบาทพร้อมกัน

- intake documentation
- traceable safety workflow by bag

ดังนั้นการออกแบบปัจจุบันและแนวทางที่จะพัฒนาต่อ จึงต้องแยกให้ชัดระหว่าง

- official blood bank หรือ HIS information
- local AIDAS case status และ documentation

architectural principle ที่สำคัญคือ

- HIS เป็นเจ้าของ official bag identity และ availability
- AIDAS เป็นเจ้าของ intraoperative case-level status และ documentation

สิ่งนี้สำคัญมากใน OR workflow เพราะ

- หนึ่งเคสอาจใช้หลาย bag
- อาจมีการ request เพิ่มระหว่างเคส
- ระบบต้องมีทั้ง overview ระดับเคส และ traceability ระดับ bag

## 9. Report generation architecture

AIDAS สร้าง anesthesia report จาก structured local case data

current report generation ใช้

- frontend report preparation
- Electron desktop environment
- PDF generation ผ่าน `pdf-lib`

report ถูกประกอบจาก

- minute timeline data
- events
- fluid and medication data
- blood product data
- staff
- form summaries

architecture นี้ทำให้ report

- review ได้ก่อน final use
- print ได้จาก local workstation
- ปรับเปลี่ยนได้เมื่อ form structure หรือ timeline logic เปลี่ยน

ตัวอย่าง practical improvement ล่าสุด ได้แก่

- เพิ่มพื้นที่ให้ events และ notes
- ปรับ line summary ให้ชัดขึ้น
- แก้ปัญหา event บางส่วนไม่ออกใน report
- ปรับ drip marker ให้เข้าใจง่ายขึ้น

## 10. Authentication และ user model

AIDAS มี local authentication layer ของตัวเอง

ระบบเก็บข้อมูล เช่น

- username
- password hash และ salt
- name
- role
- theme preference
- activity status

แนวทางนี้ทำให้ระบบรองรับ role-aware workflow ได้ แม้ยังไม่มี central identity integration เต็มรูปแบบ

ข้อดีคือเหมาะกับ

- operating room deployment
- offline-capable local use
- gradual rollout ในโรงพยาบาลที่ยังไม่มี enterprise identity integration เต็มระบบ

## 11. Runtime และ deployment model

current packaged deployment ของ AIDAS อยู่ในรูป Windows desktop application

จาก codebase ปัจจุบัน มี practical note ที่สำคัญดังนี้

- AIDAS ถูก package เป็น Electron installer
- frontend ถูก bundle เข้าไปใน desktop application
- backend ถูก start แบบ local เมื่อ AIDAS เปิดทำงาน
- default backend port คือ `3001`
- local database path ใน packaged mode อยู่ภายใต้ Porjai data folder โดยทั่วไปคือ `C:\porjai\data\flora.db`

### Current Node.js expectation

ณ สถานะปัจจุบันของ repo นี้ packaged desktop shell ยังต้องอาศัย `Node.js` บน client workstation เพื่อ launch backend process

จุดนี้เป็น operational detail ที่ควรพูดอย่างตรงไปตรงมาในการคุยเชิง technical

กล่าวอีกแบบคือ

- user มองเห็น AIDAS เป็น desktop app เดียว
- แต่ภายใน Electron shell จะ launch local `Node.js backend` แยกอีก process หนึ่ง

## 12. เหตุผลที่เลือกใช้ SQLite

`SQLite` เหมาะกับ current local-first model ของ AIDAS เพราะ

- lightweight
- deploy ง่ายในรูป single-room workstation model
- สนับสนุน local reliability ได้ดี
- ไม่ต้องพึ่ง central database availability ตั้งแต่ต้น

configuration ปัจจุบันใช้

- WAL mode
- busy timeout
- foreign keys
- normal synchronous mode
- enlarged local cache

แนวทางนี้สะท้อนความตั้งใจที่จะให้ workstation stability มาก่อน centralized complexity

## 13. Safety และ reliability mechanisms

หลายส่วนของ architecture ถูกออกแบบโดยเน้น reliability ชัดเจน เช่น

- startup recovery behavior ใน Electron
- local database path control
- minute-writer restart และ reconciliation logic
- active-case writer bootstrap on restart
- explicit health endpoints
- structured case status transitions

สิ่งเหล่านี้อาจไม่ใช่ feature ที่ดูโดดเด่น แต่เป็น decision ที่สำคัญมากใน real operating room deployment

## 14. Current limitations

สำหรับการคุยในระดับ committee ควรระบุ limitation อย่างตรงไปตรงมา

### 14.1 Windows desktop orientation

architecture ปัจจุบันออกแบบโดยยึด Windows workstation deployment เป็นหลัก

### 14.2 Local workstation model first

จุดแข็งปัจจุบันของ AIDAS คือ local case recording ส่วน central multi-room architecture ยังเป็น next-step discussion

### 14.3 Node runtime dependency in packaged deployment

packaged model ปัจจุบันยังมี dependency ต่อ local `Node.js runtime` สำหรับการ launch backend

### 14.4 Ongoing workflow refinement

บาง workflow ยังอยู่ในช่วงพัฒนาจาก real-world feedback อย่างต่อเนื่อง เช่น

- blood product process
- line form detail structure
- report layout refinement
- device-specific integration differences

## 15. เหตุใด architecture นี้จึงมีความสำคัญเชิงยุทธศาสตร์

ในมุม technical และ national capability, AIDAS แสดงให้เห็นว่า local anesthesia information platform สามารถถูกออกแบบให้มีคุณสมบัติสำคัญดังนี้

- local-first reliability
- case-centered documentation
- flexible coexistence ของ manual และ automatic entry
- separable integration layer ผ่าน Hidro
- adaptable clinical form model
- printable structured report generation

ความสำคัญของเรื่องนี้คือ มันแสดงให้เห็นว่า Thai anesthesia digital infrastructure ไม่จำเป็นต้องเริ่มต้นจาก fully imported black-box system อย่างเดียว

## 16. Suggested short talking points for speaker use

### Short version

AIDAS เป็น local-first anesthesia information system ที่ยึด anesthesia case เป็นศูนย์กลาง ใช้ desktop architecture ที่ประกอบด้วย React, Electron, Node.js และ SQLite โดยใช้ Hidro เป็น device-integration layer แยกต่างหาก เป้าหมายทางเทคนิคของระบบไม่ใช่ enterprise complexity ที่หรูหรา แต่คือ reliable case-centered documentation ที่สามารถปรับเข้ากับ Thai clinical workflow ได้รวดเร็ว

### Slightly more technical version

AIDAS แยก user interface, local backend, local case database และ device integration layer ออกจากกันอย่างชัดเจน frontend สร้างด้วย React และ package ด้วย Electron backend เป็น local Node.js และ Express service database ใช้ SQLite ใน WAL mode เพื่อความเสถียรระดับ workstation ส่วน Hidro ทำหน้าที่ observation ingestion จากอุปกรณ์ แล้ว AIDAS จึงแปลงข้อมูลเหล่านั้นให้กลายเป็น minute-level case documentation, events, fluids, medications, forms และ final report output

## 17. Suggested committee message

ถ้าคณะกรรมการถามว่า architecture นี้สำคัญอย่างไร คำตอบคือ

architecture นี้สำคัญไม่ใช่เพราะมันดูทันสมัยทางเทคนิค แต่เพราะมัน practical ต่อ clinical reality ของห้องผ่าตัดจริง มันถูกออกแบบมาสำหรับสภาพแวดล้อมที่ integration อาจไม่สมบูรณ์, manual และ automatic workflow ต้องอยู่ร่วมกันได้, local reliability สำคัญมาก และระบบต้องปรับปรุงได้จาก real clinical feedback อย่างต่อเนื่อง

