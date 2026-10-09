@echo off
cd /d %~dp0
if "%~1"=="" goto usage
set M=%~1
set N=%M::=_%
python measure.py "가온우체국_모의업무폴더" "정답표.xlsx" "결과_%N%" --model %M% --label "%~2"
pause
exit /b
:usage
echo usage: silcheuk.bat MODEL "PC spec"   ex: silcheuk.bat exaone3.5:7.8b "i5-13500 16GB CPU"
pause
