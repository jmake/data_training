param($FILE_NAME)
#$FILE_NAME="Spicy_Tech_2026-08-08_08-57-54.FIT"


$SCRIPT="D:\z2026_3\Polar\data_training_2\Tools\CreateFitFiles\intervals_icu.py"

clear 

try{deactivate}catch{ } 
& D:\z2026_3\Polar\Env_1\Scripts\activate.ps1 

Remove-Item .\modified.FIT -Force -ErrorAction SilentlyContinue

python.exe $SCRIPT --file $FILE_NAME --sport Run --output modified.FIT  

python.exe $SCRIPT --file modified.FIT --api-key 3tek853yzu358c3mtju7jdn0z


<#
-a----          08/13/26     15:38          39309 Spicy_Tech_2026-08-03_08-10-54.FIT
-a----          08/13/26     15:38          41009 Spicy_Tech_2026-08-03_08-57-46.FIT
-a----          08/13/26     15:38          57091 Spicy_Tech_2026-08-04_07-44-11.FIT
-a----          08/13/26     15:38          47690 Spicy_Tech_2026-08-05_08-30-48.FIT
-a----          08/13/26     15:39          27018 Spicy_Tech_2026-08-06_18-30-16.FIT
-a----          08/13/26     15:39          11225 Spicy_Tech_2026-08-06_19-14-25.FIT
-a----          08/13/26     15:39          48795 Spicy_Tech_2026-08-07_08-34-46.FIT
-a----          08/13/26     15:39          39938 Spicy_Tech_2026-08-08_08-57-54.FIT
-a----          08/13/26     15:39          10664 Spicy_Tech_2026-08-08_09-38-07.FIT

#>