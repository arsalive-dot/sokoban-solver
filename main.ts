// sokoban-solver: a push-optimal Sokoban solver, room by room.
//
// A level is a hallway with rooms off it, each room holding 3-4 boxes and as
// many goals, and a box pushed out of a room can never come back, so the
// rooms are independent problems joined only by the player's walk: the
// level's push optimum is the sum of its rooms' optima. This program cuts
// the hallway out of the floor, takes each part left that holds boxes as a
// room, and solves each room on its own with a breadth-first search over
// pushes (every push costs 1, so the first solved state found is
// push-optimal), the other rooms' boxes standing as walls. A state is the
// boxes' squares and the player's reachable region (named by its lowest
// square); the search prunes a box pushed onto a dead square (one no push,
// ignoring the other boxes, can ever bring to a goal) and a box pushed into
// a frozen 2x2 block of walls and boxes with a box off its goal.
//
// Budgets are in states, never the clock, so two runs write the same bytes.
// Node 22 runs this file as it is (erasable TypeScript only); no modules
// beyond Node's built-ins, no network, no randomness, no wall clock.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Search budgets, in states: work, never the clock. */
const ROOM_STATES = 250_000;
const WHOLE_STATES = 250_000;
const GREEDY_STATES = 150_000;

const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Board {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** A level in XSB text (# wall, space floor, . goal, $ box, * box on a goal, @ player, + player on a goal). */
function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  return { w, h, wall, goals: goals.sort((a, b) => a - b), boxes: boxes.sort((a, b) => a - b), player };
}

/** The squares from which a box alone can be pushed onto some goal (pulled back from the goals over open floor). */
function liveSquares(b: Board): Uint8Array {
  const live = new Uint8Array(b.w * b.h);
  const queue: number[] = [];
  for (const g of b.goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (const [dx, dy] of DIRS) {
      const d = dy * b.w + dx;
      const y = x - d;
      if (!b.wall[y] && !b.wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** The squares the player reaches from `from` with `occupied` in the way, marked in `seen` with `stamp`; the lowest. */
function reachLow(b: Board, occupied: Uint8Array, from: number, seen: Int32Array, stamp: number, stack: Int32Array): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n];
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - b.w : k === 1 ? p + b.w : k === 2 ? p - 1 : p + 1;
      if (b.wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/** Whether the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
function frozenBlock(b: Board, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  for (const a of [t, t - 1, t - b.w, t - b.w - 1]) {
    const c = a + 1;
    const d = a + b.w;
    const e = d + 1;
    if (!(b.wall[a] || occupied[a]) || !(b.wall[c] || occupied[c]) || !(b.wall[d] || occupied[d]) || !(b.wall[e] || occupied[e]))
      continue;
    if ((occupied[a] && !goal[a]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d]) || (occupied[e] && !goal[e]))
      return true;
  }
  return false;
}

/** A state's key: its region's lowest square and the boxes' squares. */
const keyOf = (boxes: number[], low: number): string => low + '|' + boxes.join(',');

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters (first direction first on ties). */
function walkTo(b: Board, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const prev = new Int32Array(b.w * b.h).fill(-1);
  const how: string[] = new Array(b.w * b.h);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * b.w + dx;
      if (b.wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

/** The square the player stands on after `moves` from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * A push-optimal solution of `board` (breadth-first over pushes), or a
 * greedy one when `greedy` (best-first on the summed walking distance of
 * the boxes to their nearest goals, for rooms the breadth-first search
 * gives up on): {pushes, moves}, or null when the search gives up.
 */
function solvePush(b: Board, maxStates: number, greedy: boolean): { pushes: number; moves: string } | null {
  const size = b.w * b.h;
  const goal = new Uint8Array(size);
  for (const g of b.goals) goal[g] = 1;
  const live = liveSquares(b);
  const solved = (boxes: number[]): boolean => boxes.every((x) => goal[x]);
  if (b.boxes.some((x) => !live[x])) return null;

  // The walking distance of every square to its nearest goal (greedy's guide).
  let dist: Int32Array | null = null;
  if (greedy) {
    dist = new Int32Array(size).fill(-1);
    const dq: number[] = [];
    for (const g of b.goals) {
      dist[g] = 0;
      dq.push(g);
    }
    for (let qi = 0; qi < dq.length; qi++) {
      const p = dq[qi];
      for (const [dx, dy] of DIRS) {
        const q = p + dy * b.w + dx;
        if (!b.wall[q] && dist[q] < 0) {
          dist[q] = dist[p] + 1;
          dq.push(q);
        }
      }
    }
  }
  const hOf = (boxes: number[]): number =>
    dist === null ? 0 : boxes.reduce((a, x) => a + (dist[x] < 0 ? 1_000_000 : dist[x]), 0);

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  // The states in the order found: their boxes, the player's square, and the push that made them from their parent.
  const sBoxes: number[][] = [b.boxes.slice()];
  const sPlayer: number[] = [b.player];
  const sParent: number[] = [-1];
  const sFrom: number[] = [-1];
  const sTo: number[] = [-1];
  const index = new Map<string, number>();
  for (const x of b.boxes) occupied[x] = 1;
  index.set(keyOf(b.boxes, reachLow(b, occupied, b.player, seen, ++stamp, stack)), 0);
  for (const x of b.boxes) occupied[x] = 0;
  if (solved(b.boxes)) return { pushes: 0, moves: '' };

  // The open list: a queue for the breadth-first search, a heap on (h, order) for the greedy one.
  const queue: number[] = [0];
  let head = 0;
  const heap: [number, number, number][] = [];
  let order = 0;
  const heapLess = (a: [number, number, number], c: [number, number, number]): boolean =>
    a[0] < c[0] || (a[0] === c[0] && a[1] < c[1]);
  const heapPush = (e: [number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i], heap[p])) break;
      const t = heap[i];
      heap[i] = heap[p];
      heap[p] = t;
      i = p;
    }
  };
  const heapPop = (): [number, number, number] => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1], heap[c])) c++;
        if (!heapLess(heap[c], heap[i])) break;
        const t = heap[i];
        heap[i] = heap[c];
        heap[c] = t;
        i = c;
      }
    }
    return top;
  };
  if (greedy) heapPush([hOf(b.boxes), order++, 0]);

  let found = -1;
  while (found < 0 && (greedy ? heap.length > 0 : head < queue.length)) {
    const s = greedy ? heapPop()[2] : queue[head++];
    const boxes = sBoxes[s];
    for (const x of boxes) occupied[x] = 1;
    const here = ++stamp;
    reachLow(b, occupied, sPlayer[s], seen, here, stack);
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const from = boxes[bi];
      for (const [dx, dy] of DIRS) {
        const d = dy * b.w + dx;
        const to = from + d;
        if (b.wall[to] || occupied[to] || !live[to]) continue;
        if (seen[from - d] !== here) continue;
        occupied[from] = 0;
        occupied[to] = 1;
        const frozen = frozenBlock(b, occupied, goal, to);
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = to;
          next.sort((x, y) => x - y);
        }
        if (!frozen && solved(next as number[])) {
          // A solved state ends the search: no key needed, and no earlier
          // state is solved, so it cannot already be in the index.
          occupied[to] = 0;
          occupied[from] = 1;
          sBoxes.push(next as number[]);
          sPlayer.push(from);
          sParent.push(s);
          sFrom.push(from);
          sTo.push(to);
          found = sBoxes.length - 1;
          break;
        }
        // The new region's low, with the box at its new square.
        const key = frozen ? '' : keyOf(next as number[], reachLow(b, occupied, from, mark, ++stamp, stack));
        occupied[to] = 0;
        occupied[from] = 1;
        if (frozen || index.has(key)) continue;
        if (sBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        index.set(key, sBoxes.length);
        sBoxes.push(next as number[]);
        sPlayer.push(from);
        sParent.push(s);
        sFrom.push(from);
        sTo.push(to);
        if (greedy) heapPush([hOf(next as number[]), order++, sBoxes.length - 1]);
        else queue.push(sBoxes.length - 1);
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;
  // The path of states, then the moves: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = sParent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = b.player;
  let boxes = b.boxes.slice();
  for (const s of path) {
    const from = sFrom[s];
    const to = sTo[s];
    const d = to - from;
    for (const x of boxes) occupied[x] = 1;
    moves += walkTo(b, occupied, player, from - d);
    for (const x of boxes) occupied[x] = 0;
    moves += d === -b.w ? 'U' : d === b.w ? 'D' : d === -1 ? 'L' : 'R';
    player = from;
    boxes = sBoxes[s];
  }
  return { pushes: path.length, moves };
}

interface Room {
  boxes: number[];
  goals: number[];
  done: boolean;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway:
 * a box there reaches no goal) out of the floor, and each part left that
 * holds boxes is a room. Null when a box starts in the hallway, a goal
 * stands in the hallway, or some part holds more or fewer boxes than goals.
 */
function roomsOf(level: Board): Room[] | null {
  const live = liveSquares(level);
  const row = Math.floor(level.player / level.w);
  const cut = new Uint8Array(level.w * level.h);
  for (let i = row * level.w; i < (row + 1) * level.w; i++) if (!level.wall[i] && !live[i]) cut[i] = 1;
  if (level.boxes.some((x) => cut[x])) return null;
  const part = new Int32Array(level.w * level.h).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < level.w * level.h; s++) {
    if (level.wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i] + dy * level.w + dx;
        if (!level.wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [], done: false });
  }
  for (const x of level.boxes) rooms[part[x]].boxes.push(x);
  for (const g of level.goals) {
    if (part[g] < 0) return null;
    rooms[part[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/**
 * The level solved room by room: each room's push-optimal solution in turn,
 * the other rooms' boxes standing as walls, the player walking on from
 * where the last room left it. Null when a room's search gives up.
 */
function solveByRooms(level: Board, rooms: Room[]): { pushes: number; moves: string } | null {
  let player = level.player;
  let pushes = 0;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms)
      if (other !== room) for (const x of other.done ? other.goals : other.boxes) wall[x] = 1;
    const sub: Board = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    let solved = solvePush(sub, ROOM_STATES, false);
    if (solved === null) solved = solvePush(sub, GREEDY_STATES, true);
    if (solved === null) return null;
    pushes += solved.pushes;
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    room.done = true;
  }
  return { pushes, moves };
}

/** The level's moves: room by room when it is a set of rooms, else a search over the whole level. */
function solveLevel(text: string): string {
  const level = parseLevel(text);
  const rooms = roomsOf(level);
  if (rooms !== null) {
    const byRooms = solveByRooms(level, rooms);
    if (byRooms !== null) return byRooms.moves;
    return '';
  }
  const whole = solvePush(level, WHOLE_STATES, false) ?? solvePush(level, GREEDY_STATES, true);
  return whole === null ? '' : whole.moves;
}

for (const id of readdirSync(I).sort()) {
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
