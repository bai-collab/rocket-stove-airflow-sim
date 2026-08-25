# Rocket Stove Airflow Sim

國小自然／科技教育用途的火箭爐空氣流動視覺化模擬器。

## 目標

讓學生透過「設計 → 點火 → 觀察 → 修改 → 再測試」的方式，觀察不同火箭爐結構是否讓空氣流動更順暢或加速。

本專案**不追求工程級 CFD 精度**，定位為教學用簡化模型，不可用於推估真實燃燒效率、污染排放或工程安全。

## MVP 功能

- 畫布上放置爐壁、進氣口、火源與煙囪
- 點火／停止模擬
- 粒子視覺化空氣流動
- 火源附近產生簡化向上浮力
- 煙囪區域提供簡化抽氣效果
- 顯示氣流順暢度、平均速度、停滯粒子比例
- 清除與重新設計

## 操作

直接開啟 `index.html` 即可使用；建議用本機靜態伺服器或 GitHub Pages。

## 參考方向

- Windy — https://windy.walnutlabs.in/
- Windy GitHub — https://github.com/aaravriyer193/Windy
- MechSimulator Wind Tunnel — https://mechsimulator.com/tools/wind-tunnel/

詳見 `docs/PROJECT_PLAN.md` 與 `docs/REFERENCES.md`。

## 教育用途聲明

本模擬器僅用於觀察不同結構造成的**相對氣流變化**，不是工程驗證工具。學生可以比較「哪個設計在本模型中比較順」，但不能據此聲稱實際燃燒效率或黑煙排放改善比例。
