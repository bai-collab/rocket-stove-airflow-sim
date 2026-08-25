# Physics v2.2：自然抽力與空氣補流

本文件說明火箭爐模型中「為什麼冷空氣會被補入」的物理依據。

> 這是教育用 reduced-order model，不是工程設計或安全計算工具。

## 1. 核心問題

只加入「熱空氣向上浮」還不夠。真實煙道中，熱空氣柱與外界冷空氣的密度差會沿高度累積成壓力差，這個壓力差才是自然抽力（stack effect）的主要驅動量之一。

## 2. 空氣密度

在近似相同大氣壓下，可由理想氣體關係估算：

```text
rho_hot = rho_ambient * T_ambient(K) / T_hot(K)
```

溫度越高，密度越低。

## 3. Stack pressure

NIST 自然通風模型給出的浮力驅動煙囪壓差可寫成：

```text
Delta_p_stack = g * H * (rho_ambient - rho_hot)
```

其中：

- `g`：重力加速度
- `H`：熱空氣柱的有效垂直高度
- `rho_ambient`：外界冷空氣密度
- `rho_hot`：煙道熱空氣平均密度

因此：

```text
煙道越高
+ 空氣越熱
=> 密度差越大
=> stack pressure 越大
=> 進氣／排氣越明顯
```

## 4. 壓差與開口速度

簡單開口常使用 classic orifice relation：

```text
v = Cd * sqrt(2 * Delta_p / rho)
```

其中 `Cd` 為 discharge coefficient。NIST 自然通風報告指出，典型簡單開口可使用約 `Cd = 0.6` 作為量級參考。

Physics v2.2 不直接把這個速度硬塞給示蹤粒子，而是：

1. 由溫度場估計熱空氣密度。
2. 由熱柱高度估計 `Delta_p_stack`。
3. 在格網上建立 stack pressure potential。
4. 讓壓力梯度：

```text
a = -(1/rho) * grad(p)
```

作用在 `u/v` 速度場。
5. 再交給原本的 incompressible pressure projection 處理流量連續性與磚牆邊界。
6. tracer 粒子只跟著最後的速度場移動。

## 5. 為什麼不再直接「吸粒子」

舊模型若寫成：

```text
火源附近缺粒子 -> 把外面粒子拉進去
```

會把視覺標記誤當成流體本身，也容易產生真空、瞬移、撞牆堆積等非物理現象。

v2.2 改成：

```text
火源加熱
-> 密度下降
-> 熱柱形成
-> stack pressure
-> 壓力梯度
-> 速度場
-> 冷空氣沿真正開放的通道補入
-> tracer 顯示流向
```

## 6. 畫布尺度

舊 v2 使用 `40 px/m`，對火箭爐尺度不合理：一個 24 px 的磚塊模組會被解讀成 0.6 m。

v2.2 的 stack correction 使用：

```text
240 px/m
```

也就是一個 24 px 模組約代表 0.10 m，較接近教學用火箭爐的尺度量級。

這仍只是模型尺度，用來讓速度與高度關係合理化，不代表學生繪製的每一格一定等於真實 10 cm。

## 7. 目前限制

- 2D，而真實火箭爐是 3D。
- 未建立完整 turbulence model。
- 熱柱高度由溫度場估計，並非真實煙囪幾何量測。
- stack pressure correction 與原本 Boussinesq CFD solver 有阻尼耦合，避免低解析度下數值不穩定。
- 開口摩擦、局部損失、粗糙度尚未完整建模。
- `Cd = 0.6` 是簡單開口的量級參考，不是本專案特定爐體經實驗校正的係數。

## 8. 參考資料

- NIST GCR 01-820, *Application of Natural Ventilation for U.S. Commercial Buildings*.
  - Hydrostatic pressure: `Delta p = rho g Delta z`
  - Buoyancy-driven stack pressure: `Delta p_s = (rho_o - rho_i) g Delta z`
  - Classic orifice relation and discharge coefficient discussion.
  - https://www.nist.gov/document/nist-gcr01-820pdf
- OpenFOAM Boussinesq equation of state:
  - `rho = rho0 * [1 - beta (T - T0)]`
  - https://doc.openfoam.com/2212/tools/processing/models/thermophysical/equation-of-state/rtm/Boussinesq/
