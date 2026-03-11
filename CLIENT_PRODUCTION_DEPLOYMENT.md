# AIDAS + HIDRO Client Setup

## 1) Copy from dev PC
Copy these to client PC:

- whole repo folder -> `C:\porjai\flora-aplha`
- prepared master DB if needed -> `deploy-artifacts\flora.master.db`

## 2) Place in prod client
- repo path:
  - `C:\porjai\flora-aplha`
- DB path:
  - `C:\porjai\data\flora.db`

Create DB folder first if needed:

```powershell
New-Item -ItemType Directory -Force C:\porjai\data | Out-Null
```

If client has no old case data:
- copy prepared DB to:
  - `C:\porjai\data\flora.db`

If client already has old case data:
- keep existing `C:\porjai\data\flora.db`
- do not replace it
- migrate master data into existing DB after setup

## 3) Setup commands
Run once on client PC:

```cmd
cd /d C:\porjai\flora-aplha
npm.cmd install

cd /d C:\porjai\flora-aplha\backend
npm.cmd install

cd /d C:\porjai\flora-aplha\ivy
npm.cmd install

cd /d C:\porjai\flora-aplha\frontend-v2
npm.cmd install

cd /d C:\porjai\flora-aplha
npm.cmd run desktop:build:web
```

If client already has old case data and you want to update master data only:

```cmd
copy C:\porjai\data\flora.db C:\porjai\data\flora.backup.db

cd /d C:\porjai\flora-aplha
node backend\scripts\migrate-master-data.js --from deploy-artifacts\flora.master.db --to C:\porjai\data\flora.db
```

## 4) Run Hidro at startup
Use:
- `C:\porjai\flora-aplha\start-hidro-hidden.vbs`

Put shortcut of this file in:
- `shell:startup`

## 5) Run Aidas from desktop icon
Use:
- `C:\porjai\flora-aplha\start-aidas-hidden.vbs`

Create desktop shortcut:
- target = `C:\porjai\flora-aplha\start-aidas-hidden.vbs`
- start in = `C:\porjai\flora-aplha`
- name = `Aidas`

Set icon:
- `C:\porjai\flora-aplha\electron\assets\aidas-app.ico`
