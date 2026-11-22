# sokoban-solver: a push-optimal Sokoban solver, room by room

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/arsalive-dot/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/arsalive-dot/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

An entry for make.fun's [sokoban-solver-01-run-20261121](https://make.fun/bounty/sokoban-solver-01-run-20261121)
bounty: one program answers every Sokoban level of a set in as few pushes
as it can. A level is a hallway with rooms off it, and a box pushed out of
a room can never come back, so each room is solved on its own and the
level's optimum is the sum of its rooms' optima.

- `main.ts` — the solver. It cuts the hallway (the player's row, dead
  squares only) out of the floor, takes each part left that holds boxes as
  a room, and solves each room with a breadth-first search over pushes
  (every push costs 1, so the first solved state found is push-optimal),
  the other rooms' boxes standing as walls. A state is the boxes' squares
  plus the player's reachable region (named by its lowest square); the
  search prunes pushes onto dead squares and into frozen 2x2 blocks. A
  greedy best-first search (summed walking distance to the nearest goal)
  stands behind it for a room the breadth-first search gives up on.
  Budgets are in states, never the clock, so two runs write the same bytes.

## Verify

From the kit directory (`sokoban-solver-01-run-20261121-kit`), with this
repository at `../repo`:

```sh
# practice set, then the kit's scorer
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node ../repo/main.ts
MAKEFUN_OUTPUT_DIR=out MAKEFUN_REFERENCE_DIR=practice/reference \
  MAKEFUN_SCORES_DIR=scores node program/scorer/score.ts
# or the official local grade (runs the entry twice, checks determinism)
node cli/makefun.mjs grade-local --kit . --bot ../repo --driver process
```

Practice set: 1,000,000 — every level solved in P* pushes (13, 16, 29, 47,
60), in about 1 second for the whole set (limit 60). The house baseline
plain-astar 1.0.0 scores 200,000 on the same set (it solves only the first
level). 20 freshly drawn sets (100 levels, kit generator): 1,000,000 on
every one. See `work/BUILD-NOTES.md` for the numbers.

## Licence

MIT — see `LICENSE`.
