# AIDAS Quick Troubleshooting (A5)

## เมื่อข้อมูล Monitor หรือ Machine ไม่ขึ้น

### 1. ดูก่อนว่าอะไรหาย

- `Monitor` หาย
- `Machine` หาย
- หายทั้งคู่

### 2. เช็กสาย

- เช็กสายจากเครื่องแพทย์
- เช็ก USB / serial adapter
- เช็กว่าสายไม่หลวม

### 3. ใช้ USB Hub Switch

- ปิด switch ของ port ที่มีปัญหา
- รอ `5 วินาที`
- เปิดกลับ
- รอ `30-60 วินาที`

ข้อสำคัญ

- ปิดเฉพาะ port ของอุปกรณ์ที่มีปัญหา
- ไม่ต้องปิดทุกช่องพร้อมกัน

### 4. ถ้ายังไม่กลับ

- restart `Hidro`
- restart `AIDAS`
- ถ้ายังไม่กลับ ให้ restart computer

### 5. ถ้าต้องแจ้ง support

แจ้งข้อมูลนี้

- ห้อง / room
- เวลาเกิดปัญหา
- `Monitor` หรือ `Machine`
- ได้ลอง toggle switch หรือ restart แล้วหรือยัง

## Quick Guide

### Monitor data หาย

1. เช็กสาย `monitor`
2. ปิด/เปิด USB switch ของ `monitor`
3. รอ `30-60 วินาที`

### Machine data หาย

1. เช็กสาย `machine`
2. ปิด/เปิด USB switch ของ `machine`
3. รอ `30-60 วินาที`

### หายทั้งคู่

1. เช็ก USB hub และ `Hidro`
2. restart `Hidro` / `AIDAS`
3. ถ้ายังไม่กลับ restart computer
