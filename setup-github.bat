@echo off
chcp 65001 >nul
echo ================================================
echo   DnD VTT - Upload ke GitHub
echo ================================================
echo.

:: Cek apakah git terinstall
git --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git tidak ditemukan!
    echo Silakan install Git dulu dari: https://git-scm.com/download/win
    echo Setelah install, jalankan script ini lagi.
    pause
    exit /b 1
)
echo [OK] Git ditemukan.

:: Cek apakah folder ini berisi project yang benar
if not exist "server.js" (
    echo.
    echo [ERROR] File server.js tidak ditemukan!
    echo Pastikan script ini dijalankan dari dalam folder dnd-vtt
    echo Contoh: folder yang isinya ada server.js, package.json, public\, dsb.
    pause
    exit /b 1
)
echo [OK] Project ditemukan.
echo.

:: Buat .gitignore
echo Membuat .gitignore...
(
    echo node_modules/
    echo data/
) > .gitignore
echo [OK] .gitignore dibuat.

:: Init git repo
echo.
echo Menginisialisasi Git...
git init
git branch -M main

:: Add semua file
echo.
echo Menambahkan file ke Git...
git add .
git commit -m "Initial commit - DnD VTT"

:: Set remote ke GitHub
echo.
echo Menghubungkan ke GitHub...
git remote remove origin >nul 2>&1
git remote add origin https://github.com/kurokishi354/dnd-vtt.git

echo.
echo ================================================
echo   SIAP PUSH KE GITHUB
echo ================================================
echo.
echo Script akan push ke:
echo   https://github.com/kurokishi354/dnd-vtt
echo.
echo PENTING: Kalau muncul popup login GitHub, masukkan
echo username dan password/token GitHub kamu.
echo.
pause

git push -u origin main

if errorlevel 1 (
    echo.
    echo [ERROR] Push gagal!
    echo Kemungkinan penyebab:
    echo   1. Repo belum dibuat di GitHub - buat dulu di github.com/new
    echo      Nama repo: dnd-vtt
    echo   2. Login GitHub gagal - coba lagi
    pause
    exit /b 1
)

echo.
echo ================================================
echo   BERHASIL! Project sudah ada di GitHub
echo ================================================
echo.
echo Repo kamu: https://github.com/kurokishi354/dnd-vtt
echo.
echo Langkah selanjutnya - Deploy ke Railway:
echo   1. Buka https://railway.app
echo   2. Login dengan GitHub
echo   3. Klik "New Project"
echo   4. Pilih "Deploy from GitHub repo"
echo   5. Pilih repo "dnd-vtt"
echo   6. Tunggu deploy selesai
echo   7. Klik Settings ^> Domains ^> Generate Domain
echo.
echo Buka link di atas sekarang? (tekan sembarang tombol)
pause
start https://railway.app
