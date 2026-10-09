@echo off
chcp 65001 >nul
cd /d %~dp0
if "%~1"=="" (echo 사용법: 실측.bat 모델이름 "PC 사양"  예) 실측.bat exaone3.5:7.8b "i5-13500 16GB CPU" & pause & exit /b 1)
set M=%~1
set N=%M::=_%
python measure.py 가상기관_모의업무폴더 정답표.xlsx 결과_%N% --model %M% --label "%~2"
pause
