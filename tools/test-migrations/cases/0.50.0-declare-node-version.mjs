// 0.50.0 — `.nvmrc` is written from the Node the devcontainer ALREADY runs, so the next upgrade moves nothing. The
// shapes: a house.Dockerfile build (0.48+), a pre-0.48 `image`, an agent-only Node feature, the stock VS Code template's
// `typescript-node:1-22-bookworm` (image 1, Node 22), a feature `lts` / `22.11`, a project Dockerfile on a non-Node base
// (never guessed), a project's own .nvmrc (kept, a disagreement reported), an alias in it (resolved, dated), a
// .node-version (the declaration — no second file), no devcontainer at all, and a functions runtime that disagrees.
import { createRequire } from 'node:module';

const { writeJson, logger } = createRequire(import.meta.url)('@nx/devkit');

const said = [];
const listen = () => {
  said.length = 0;
  const original = logger.warn;
  logger.warn = (...args) => {
    said.push(args.join(' '));
    original(...args);
  };
};
const nvmrc = (tree) => (tree.exists('.nvmrc') ? tree.read('.nvmrc', 'utf8') : undefined);
const houseBuilt = (tree, dockerfile) => {
  writeJson(tree, '.devcontainer/devcontainer.json', { build: { dockerfile: 'house.Dockerfile' } });
  tree.write('.devcontainer/house.Dockerfile', dockerfile);
};
const imaged = (image, extra = {}) => (tree) => writeJson(tree, '.devcontainer/devcontainer.json', { image, ...extra });

export default {
  name: '0.50.0 · declare-node-version',
  ladder: ['0.50.0/declare-node-version'],
  cases: [
    {
      name: 'house.Dockerfile FROM typescript-node:22 → .nvmrc 22',
      setup: (tree) => houseBuilt(tree, '# GENERATED\nFROM mcr.microsoft.com/devcontainers/typescript-node:22\n'),
      expect: (tree, t) => t.ok(nvmrc(tree) === '22\n', `.nvmrc: ${nvmrc(tree)}`),
    },
    {
      name: 'a pre-0.48 devcontainer image (JSONC, comments) → its major',
      setup: (tree) => tree.write('.devcontainer/devcontainer.json', '{\n  // the image\n  "image": "mcr.microsoft.com/devcontainers/typescript-node:24",\n}\n'),
      expect: (tree, t) => t.ok(nvmrc(tree) === '24\n', `.nvmrc: ${nvmrc(tree)}`),
    },
    {
      name: 'an agent-only devcontainer: the Node feature\'s version',
      setup: (tree) =>
        writeJson(tree, '.devcontainer/devcontainer.json', {
          build: { dockerfile: 'house.Dockerfile' },
          features: { 'ghcr.io/devcontainers/features/node:1': { version: '20' } },
        }),
      expect: (tree, t) => t.ok(nvmrc(tree) === '20\n', `.nvmrc: ${nvmrc(tree)}`),
    },
    {
      name: "the project's own .nvmrc is kept — a disagreement with the container is reported (the next upgrade follows .nvmrc)",
      setup: (tree) => {
        listen();
        tree.write('.nvmrc', 'v24.3.0\n');
        houseBuilt(tree, 'FROM mcr.microsoft.com/devcontainers/typescript-node:22\n');
      },
      expect: (tree, t) => {
        t.ok(nvmrc(tree) === 'v24.3.0\n', 'kept byte for byte');
        t.ok(said.some((line) => /declares Node 24, but the devcontainer runs Node 22/.test(line)), `reported: ${said}`);
      },
    },
    {
      name: 'an alias in .nvmrc is kept — the house reads it (lts/* resolves, dated); a disagreement with the container is reported',
      setup: (tree) => {
        listen();
        tree.write('.nvmrc', '# team default\nlts/*\n');
        houseBuilt(tree, 'FROM mcr.microsoft.com/devcontainers/typescript-node:22\n');
      },
      expect: (tree, t) => {
        t.ok(nvmrc(tree) === '# team default\nlts/*\n', 'kept byte for byte');
        t.ok(said.some((line) => /declares Node 24, but the devcontainer runs Node 22/.test(line)), `reported: ${said}`);
      },
    },
    {
      name: 'a personal nvm alias in .nvmrc is kept and reported (it means something else on every machine)',
      setup: (tree) => {
        listen();
        tree.write('.nvmrc', 'system\n');
      },
      expect: (tree, t) => {
        t.ok(nvmrc(tree) === 'system\n', 'kept');
        t.ok(said.some((line) => /names no Node the house can resolve/.test(line)), `reported: ${said}`);
      },
    },
    {
      name: 'the stock VS Code template (typescript-node:1-22-bookworm) → 22, never the image version 1',
      setup: imaged('mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm'),
      expect: (tree, t) => t.ok(nvmrc(tree) === '22\n', `.nvmrc: ${nvmrc(tree)}`),
    },
    {
      name: 'typescript-node:22-bookworm → 22',
      setup: imaged('mcr.microsoft.com/devcontainers/typescript-node:22-bookworm'),
      expect: (tree, t) => t.ok(nvmrc(tree) === '22\n', `.nvmrc: ${nvmrc(tree)}`),
    },
    {
      name: 'a Node feature at "22.11" → 22',
      setup: imaged('mcr.microsoft.com/devcontainers/base:debian', { features: { 'ghcr.io/devcontainers/features/node:1': { version: '22.11' } } }),
      expect: (tree, t) => t.ok(nvmrc(tree) === '22\n', `.nvmrc: ${nvmrc(tree)}`),
    },
    {
      name: 'a Node feature at "lts" (its default) → the LTS major as of 0.50.0, pinned and said',
      setup: (tree) => {
        listen();
        const info = logger.info;
        logger.info = (...args) => {
          said.push(args.join(' '));
          info(...args);
        };
        imaged('mcr.microsoft.com/devcontainers/base:debian', { features: { 'ghcr.io/devcontainers/features/node:1': {} } })(tree);
      },
      expect: (tree, t) => {
        t.ok(nvmrc(tree) === '24\n', `.nvmrc: ${nvmrc(tree)}`);
        t.ok(said.some((line) => /lts \(its default\)[\s\S]*as of 2026-10-07[\s\S]*now pinned/.test(line)), `said: ${said}`);
      },
    },
    {
      name: "a project Dockerfile on a non-Node base: nothing written, never guessed — reported",
      setup: (tree) => {
        listen();
        writeJson(tree, '.devcontainer/devcontainer.json', { build: { dockerfile: 'Dockerfile' } });
        tree.write('.devcontainer/Dockerfile', 'FROM ubuntu:24.04\nRUN apt-get install -y nodejs\n');
      },
      expect: (tree, t) => {
        t.missing('.nvmrc');
        t.ok(said.some((line) => /cannot be read[\s\S]*will not guess/.test(line)), `reported: ${said}`);
      },
    },
    {
      name: '.node-version is the declaration: no .nvmrc written beside it',
      setup: (tree) => {
        tree.write('.node-version', '22.11.0\n');
        houseBuilt(tree, 'FROM mcr.microsoft.com/devcontainers/typescript-node:22\n');
      },
      expect: (tree, t) => t.missing('.nvmrc'),
    },
    {
      name: 'no devcontainer Node anywhere: nothing written (nothing reads it here yet)',
      setup: () => {},
      expect: (tree, t) => t.missing('.nvmrc'),
    },
    {
      name: 'a Cloud Functions runtime that disagrees is reported, never rewritten',
      setup: (tree) => {
        listen();
        houseBuilt(tree, 'FROM mcr.microsoft.com/devcontainers/typescript-node:24\n');
        writeJson(tree, 'firebase.json', {});
        writeJson(tree, 'apps/functions/project.json', { name: 'functions', root: 'apps/functions', projectType: 'application' });
        writeJson(tree, 'apps/functions/package.json', { name: 'functions', engines: { node: '22' } });
      },
      expect: (tree, t) => {
        t.ok(nvmrc(tree) === '24\n', 'seeded from the container');
        t.ok(JSON.parse(tree.read('apps/functions/package.json', 'utf8')).engines.node === '22', 'the deployed runtime untouched');
        t.ok(said.some((line) => /deploys Cloud Functions on Node "22", but the project runs Node 24/.test(line)), `reported: ${said}`);
      },
    },
  ],
};
