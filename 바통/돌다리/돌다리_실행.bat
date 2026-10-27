@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 휴대용 묶음(python 폴더 포함)이면 그것을, 아니면 설치된 파이썬을 쓴다
if exist "%~dp0python\python.exe" (
  "%~dp0python\python.exe" -I -X utf8 "%~dp0app\server.py" %*
  goto ran
)
if not exist "%~dp0server.py" (
  echo.
  echo  이 폴더에는 server.py가 없습니다.
  echo  바로 쓰려면 실행물 폴더의 doldari_v3.8_portable_win64.zip 을 풀어 그 안의 돌다리_실행.bat 을 누르세요.
  echo  파이썬으로 소스를 돌리려면 돌다리_소스_v3.8.zip 을 먼저 풀고 그 폴더의 돌다리_실행.bat 을 누르세요.
  goto end
)
rem where python 은 윈도 스토어의 빈 python도 찾으므로, 실제로 돌려 보고 고른다
python -c "import sys" >nul 2>nul
if not errorlevel 1 (
  python -I -X utf8 "%~dp0server.py" %*
  goto ran
)
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
  py -3 -I -X utf8 "%~dp0server.py" %*
  goto ran
)
echo.
echo  파이썬이 설치되어 있지 않습니다.
echo  휴대용 묶음 doldari_v3.8_portable_win64.zip 을 내려받아 압축을 푼 뒤, 그 안의 돌다리_실행.bat 을 누르세요.
echo  파이썬을 설치했다면 이 폴더에서 python -m pip install -r 부품목록.txt 를 한 번 실행하세요.
goto end
:ran
if errorlevel 1 (
  echo.
  echo  시작하지 못했습니다. 위의 문장을 사진으로 찍어 담당자에게 보내 주세요.
)
:end
echo.
echo  아무 키나 누르면 이 창이 닫힙니다.
pause >nul
