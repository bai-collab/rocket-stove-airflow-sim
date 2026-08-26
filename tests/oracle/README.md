# Module Physics v2.6 oracle

```text
node tests/oracle/verify.mjs
```

`verify.mjs` runs the ES-module engine directly through `module-runner.mjs` and
compares all four scenarios with the frozen JSON files in `golden/`. The
comparison is bit-exact for every captured field and scalar counter.

```text
node tests/oracle/verify.mjs --snapshot-dir <snapshot-directory>
```

The oracle uses only built-in Node modules; no npm install is required.
