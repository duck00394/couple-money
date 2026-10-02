-- 每筆交易鎖住「本位幣 → 台幣」的參考匯率。
--
-- 既有的 rateForeignUnits / rateBaseMinor 鎖的是「交易幣別 → 帳本本位幣」，
-- 只有在台幣帳本記一筆日圓消費那種情況才會有值。
-- 日圓帳本記日圓時幣別等於本位幣，沒有換算，但畫面上還是會顯示「約 NT$」——
-- 那一行以前是用帳本**目前**的匯率現算的，所以改匯率會把歷史的台幣參考值一起改掉。
-- 這兩欄把當下的參考匯率原樣鎖在這一列上，之後改設定不會動到它。
--
-- 舊資料一律留 NULL：沒有辦法知道當時的匯率是多少，寧可沒有歷史參考值，
-- 也不要拿現在的匯率回填成看起來像真的的數字。讀取端遇到 NULL 會退回帳本目前的匯率。
ALTER TABLE "Transaction" ADD COLUMN "homeRateUnits" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "homeRateMinor" INTEGER;
