@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 휴대용 묶음(python 폴더 포함)이면 그것을, 아니면 설치된 파이썬을 쓴다
if exist "%~dp0python\python.exe" (
  "%~dp0python\python.exe" "%~dp0app\server.py" %*
  goto end
)
where python >nul 2>nul
if not errorlevel 1 (
  python server.py %*
  goto end
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py %*
  goto end
)
echo.
echo  파이썬이 설치되어 있지 않습니다.
echo  휴대용 묶음 doldari_v3.6_portable_win64.zip 을 내려받아 압축을 푼 뒤, 그 안의 돌다리_실행.bat 을 누르세요.
echo  (파이썬을 설치했다면 이 폴더에서 python -m pip install -r 부품목록.txt 를 한 번 실행)
:end
pause
