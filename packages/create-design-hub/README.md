# create-design-hub

Scaffolds a Design Hub project: a thin folder of prototypes, kit materials and docs that installs the `design-hub` package and keeps nothing else.

```bash
npm create design-hub@latest my-project
cd my-project
pnpm dev
```

The scaffolder pins `design-hub` to its own version, starts a git repo, installs dependencies, copies the skills into `.claude/skills/` and makes the first commit. Pass `--help` for the flags, including `--visibility` for creating a GitHub repo and `--link` for developing against a local checkout of the package.

People without a terminal can run the setup app instead: see the `setup/` folder.

MIT. Source: https://github.com/milesroxas/design-hub
