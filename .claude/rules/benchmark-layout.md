# Benchmark ownership in Foundry

Keep benchmark runners, datasets, measurement tests and experiments in the
parent Foundry `benchmarks/<plugin>/` directory. Do not add a benchmark tree to
the installable plugin or recreate the old `.benchmarks/` directory.

Plugin `tests/` contains functional tests of the product. Tests of a benchmark
runner, scorer or evidence schema belong beside that harness in Foundry.
Preserve existing test coverage when moving a harness.

Use `.scratch/` for local maintenance output, migration backups and temporary
validation dependencies. Research narratives belong in `docs/<plugin>/`.
Keep model names, revisions and historical results attached to their actual
experiments. Organization work does not authorize paid runs or global installs.
