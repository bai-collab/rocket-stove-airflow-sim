# Legacy Physics v2.6 oracle

在專案根目錄執行：

```text
node tests/oracle/record-legacy.mjs
node tests/oracle/verify.mjs
```

`record-legacy.mjs` 以 `index.html` 的 11 支 classic scripts 建立 Node vm
runtime，將四個 §K 場景寫入 `tests/oracle/golden/`。`verify.mjs` 會重新跑
legacy、比較全部欄位 bytes 與 scalar；也可比較外部 snapshot set：

```text
node tests/oracle/verify.mjs --snapshot-dir <snapshot-directory>
```

只使用 Node 內建模組，不需要 npm install。
