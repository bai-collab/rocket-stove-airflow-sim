# Physics v2：火箭爐空氣流動模型

本文件說明目前 `js/app-v2.js` 的物理模型、公式與教育用途限制。

> 本系統是國小探究活動使用的即時近似模型，不是工程等級 CFD，也不能用來預測真實燃燒效率、排放量或安全性。

## 1. 核心架構

Physics v2 不再把畫面上的粒子當成空氣本體。

物理本體改成二維格網：

- `u, v`：空氣速度場
- `pressure`：壓力場
- `temperature`：空氣溫度場
- `oxygen`：相對氧氣濃度
- `smoke`：燃燒後氣體／煙的被動 scalar
- `solid`：磚牆格
- `brickTemp`：磚牆溫度

畫面粒子只做 tracer，用來把速度場視覺化。

## 2. 熱空氣與浮力

空氣密度與溫度的基本關係來自理想氣體：

```text
p = rho * R * T
```

低速、接近大氣壓的教育模型採用 Boussinesq 型近似：

```text
rho ≈ rho0 * [1 - beta * (T - T0)]
```

因此溫度越高，空氣密度越低，產生向上的浮力。

程式中的浮力形式：

```text
a_y = -g * beta * (T - T0)
```

再乘上畫布的 pixels-per-meter 尺度。為維持手機即時模擬穩定，目前對溫差設有上限，因此數值不能當成真實工程速度。

## 3. 速度與壓力

目前採用 Stable Fluids 類型的半拉格朗日 advection：

```text
u(x,t+dt) ≈ u(x - u*dt, t)
```

之後進行 pressure projection，使速度場近似滿足：

```text
div(u) = 0
```

亦即低速流體中，局部空氣被帶走時，壓力場會驅使鄰近空氣補入，而不是人工指定某些粒子被「吸」進去。

壓力使用 Poisson 方程的 Jacobi iteration 近似求解。

## 4. 磚牆邊界

磚牆格標記為 `solid`。

基本條件：

```text
空氣不能穿過 solid
```

pressure projection 與速度邊界共同處理牆面法向速度，不再使用「粒子撞牆後隨機反彈」作為主要流體模型。

## 5. 直火與隔火

### 直火

火源會對一定半徑內、且與火源之間沒有被磚牆遮蔽的空氣格加入熱量。

程式會做 line-of-sight 檢查：

```text
🔥 ───── air     可直接加熱
```

### 隔火

如果火源與空氣之間有磚牆：

```text
🔥 ── ███ ── air
```

牆後空氣不接受火源直接加熱。

熱量改走：

```text
火源
→ 暴露面的磚頭升溫
→ 磚頭內部導熱
→ 另一側磚面升溫
→ 對流加熱牆後空氣
```

因此「直火」與「隔火」會產生不同的空氣溫升速度。

## 6. 磚頭導熱

目前使用離散熱擴散概念：

```text
dT/dt ∝ 鄰近磚格平均溫度 - 本格溫度
```

磚面與鄰接空氣使用簡化對流交換：

```text
q ∝ (T_brick - T_air)
```

這些係數目前為教育視覺化縮放值，不代表特定耐火磚、紅磚或水泥磚的材料參數。

## 7. 氧氣與燃燒後氣體

火源附近會：

- 消耗 `oxygen`
- 增加 `smoke`
- 提升 `temperature`

外部畫布邊界視為無限環境空氣庫，流入邊界會恢復環境溫度、氧氣與低煙濃度。

完全被 solid 包圍的區域不會直接從外界得到氧氣，因此燃燒會逐步降低並熄滅。

## 8. Tracer 粒子

畫面上的點不是空氣分子，也不參與壓力或浮力求解。

每個 tracer：

```text
位置 += interpolate(velocity field) * dt
```

顏色依所在格網狀態顯示：

- 藍：較冷、較新鮮空氣
- 橘：較熱空氣
- 灰：燃燒後氣體／煙較高

因此 tracer 密度不能直接解讀成真實空氣密度。

## 9. 目前仍屬近似的地方

- 二維模型，真實火箭爐是三維流場。
- 尚未建立完整 turbulence model。
- 未計算真實燃料熱釋放率 HRR。
- radiation 目前只用 line-of-sight + 距離衰減概念，尚未做 view factor。
- 磚頭材料參數尚未區分種類。
- Boussinesq 在大溫差燃燒情境並非完整模型，目前為教育用途並限制最大浮力溫差。
- smoke / oxygen 為簡化 scalar，不是完整化學反應模型。

## 10. 後續優先項目

1. 驗證 pressure projection 是否能自然形成「火源上升 → 側邊補氣」。
2. 加入速度向量／流線顯示，用來檢查流場，而不只看 tracer。
3. 比較直火與隔火的溫度場。
4. 加入可選磚材參數：導熱率、熱容量。
5. 加入簡化煙囪高度／自然抽力比較。
6. 最後才考慮校正到公開 CFD / FDS 範例。

## 參考基礎

- NASA Glenn Research Center — Equation of State / Ideal Gas
  - https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/equation-of-state/
- OpenFOAM — Boussinesq equation of state
  - https://doc.openfoam.com/2212/tools/processing/models/thermophysical/equation-of-state/rtm/Boussinesq/
- NVIDIA GPU Gems — Fast Fluid Dynamics Simulation on the GPU
  - https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu
- NIST Fire Dynamics Simulator documentation
  - https://pages.nist.gov/fds/manuals.html
