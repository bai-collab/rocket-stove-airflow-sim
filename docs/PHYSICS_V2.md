# Physics v2：火箭爐空氣流動模型

> 目前網頁執行版本為 **Physics v2.5**。本文件說明共同的流體核心；v2.5 新增的未完全燃燒、黑煙與二次燃燒模型，詳見 `SECONDARY_COMBUSTION_V2_5.md`。

本系統是國小自然／科技探究活動使用的即時近似模型，不是工程等級 CFD，也不能用來預測真實燃燒效率、排放量或安全性。

## 1. 核心架構

物理本體是二維 Eulerian 格網，不是畫面上的粒子：

- `u, v`：空氣速度場
- `pressure`：壓力場
- `temperature`：空氣溫度場
- `oxygen`：相對氧氣濃度
- `smoke`：相對黑煙／不完全燃燒產物 scalar
- `solid`：磚牆格
- `brickTemp`：磚牆溫度

Physics v2.5 另外加入：

- `unburnedGas`：尚未完全燃燒的可燃氣體代理值
- `exhaustGas`：已燃燒後氣體代理值

畫面粒子只做 tracer，用來把速度場視覺化；粒子數量不是空氣密度。

## 2. 熱空氣與浮力

低速、接近大氣壓的教育模型採用 Boussinesq 型近似：

```text
rho ≈ rho0 × [1 - beta × (T - T0)]
```

因此溫度越高，空氣密度越低，產生向上的浮力。程式中的基本形式：

```text
a_y = -g × beta × (T - T0)
```

為保持即時模擬穩定，溫差與速度均有數值上限，因此畫面速度不能直接解讀為真實 m/s。

## 3. 速度與壓力

目前採用 Stable Fluids 類型的半拉格朗日 advection，再進行 pressure projection，使速度場近似滿足：

```text
div(u) = 0
```

也就是局部空氣被帶走時，壓力場會驅使鄰近空氣補入，而不是在爐內人工生成空氣。

## 4. 進排氣與開口

Physics v2.5 不再需要「進氣口」或「煙囪」物件。

```text
外界空氣 ↔ 幾何開口 ↔ 爐內流場
```

只要爐壁有開口，求解出的壓力與速度場就可以讓空氣自然流入或流出。若完全被 `solid` 包圍，該區域不會直接獲得外界新鮮空氣。

## 5. 磚牆邊界

磚牆格標記為 `solid`，空氣不能穿牆。pressure projection 與速度邊界共同處理牆面法向速度，不以 tracer 撞牆反彈作為流體本體。

## 6. 火焰、熱羽流與磚牆受熱

火源對附近空氣形成小型高溫核心，主要對流加熱沿上升熱羽流分布；磚牆則透過 line-of-sight 的簡化輻射先受熱，再以離散導熱與表面對流將熱量傳至另一側空氣。

因此牆後空氣不會被火源直接穿牆加熱。

## 7. 煙囪效應

粗網格對高溫氣柱造成的自然抽力解析有限，因此另加入 reduced-order stack pressure correction。概念來自：

```text
dp_stack = g × H × (rho_ambient - rho_hot)
```

煙囪效應依賴實際高溫氣柱與連通幾何，而不是靠「煙囪圖示」人工抽氣。

## 8. 通道阻力與縮口

狹長通道加入簡化 Darcy-Weisbach 阻力；連續方程式修正用於表現同一連通流管中截面縮小時局部速度提高的趨勢。

這些都是教學尺度近似，不能取代真實管路計算。

## 9. 氧氣、黑煙與二次燃燒

Physics v2.5 的燃燒層不再只有「火源產煙」。流程改為：

```text
燃料受熱
  ↓
unburnedGas
  ↓
一次燃燒 / 不完全燃燒
  ↓
高溫 + O2 + 混合 + 停留時間
  ↓
二次燃燒
```

黑煙 `smoke` 不做全域時間衰減。它主要透過：

1. 氣流由畫布開放邊界排出。
2. 在二次燃燒中被簡化氧化。

而降低。

詳細反應規則與教育限制見 `SECONDARY_COMBUSTION_V2_5.md`。

## 10. Tracer 粒子

每個 tracer 依速度場移動：

```text
position += interpolate(velocity field) × dt
```

- 藍：較冷／新鮮空氣示蹤
- 橘：較熱空氣示蹤
- 灰：曾通過燃燒產物區的示蹤

v2.5 中 tracer 不會因在邊界附近停住就瞬間傳送到別處；只有真正離開畫布後才從外界邊界重新進入。

黑煙是否累積應看 `smoke` scalar 的灰黑背景，而不是數 tracer 數量。

## 11. 目前仍屬近似的地方

- 二維模型，真實火箭爐是三維流場。
- 沒有完整 turbulence model。
- 未計算真實燃料熱釋放率 HRR。
- radiation 為簡化 line-of-sight + 距離衰減。
- 磚頭材料參數尚未區分種類。
- Boussinesq 在燃燒的大溫差情境只作教育近似。
- `oxygen`、`smoke`、`unburnedGas`、`exhaustGas` 都是簡化 scalar，不是完整 species chemistry。
- 相對黑煙排出只能比較本模型中的設計，不能換算真實 PM2.5、CO 或黑碳排放。

## 12. 建議後續驗證

1. 完全密閉：氧氣下降、煙與未燃氣體累積、火源熄滅。
2. 開放火源：熱氣上升，周圍空氣自然補入。
3. 基本煙道：高溫氣柱形成自然抽力。
4. 高溫煙氣區導入外界空氣：二次燃燒增加、相對黑煙下降。
5. 開口過大或冷空氣過量：高溫區降溫，二次燃燒不應無限改善。
6. 改變 tracer 數量：所有物理指標應保持相同。

## 參考基礎

- NASA Glenn Research Center — Equation of State / Ideal Gas
- OpenFOAM — Boussinesq equation of state
- NVIDIA GPU Gems — Fast Fluid Dynamics Simulation on the GPU
- NIST Fire Dynamics Simulator documentation
