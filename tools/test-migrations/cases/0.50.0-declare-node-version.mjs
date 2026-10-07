// 0.50.0 — `.nvmrc` is written from the Node the devcontainer ALREADY runs, so the next upgrade moves nothing. The
// shapes: a house.Dockerfile (0.48+), a pre-0.48 `image`, an agent-only Node feature, a project's own .nvmrc (kept, a
// disagreement reported), an alias in it, no devcontainer at all, and a functions runtime that disagrees (reported).
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

export default {
  name: '0.50.0 · declare-node-version',
  ladder: ['0.50.0/declare-node-version'],
  cases: [
    {
      name: 'house.Dockerfile FROM typescript-node:22 → .nvmrc 22',
      setup: (tree) => tree.write('.devcontainer/house.Dockerfile', '# GENERATED\nFROM mcr.microsoft.com/devcontainers/typescript-node:22\n'),
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
        tree.write('.devcontainer/house.Dockerfile', 'FROM mcr.microsoft.com/devcontainers/typescript-node:22\n');
      },
      expect: (tree, t) => {
        t.ok(nvmrc(tree) === 'v24.3.0\n', 'kept byte for byte');
        t.ok(said.some((line) => /declares Node 24, but the devcontainer runs Node 22/.test(line)), `reported: ${said}`);
      },
    },
    {
      name: 'an alias in .nvmrc is kept and reported (the house now refuses it)',
      setup: (tree) => {
        listen();
        tree.write('.nvmrc', 'lts/*\n');
      },
      expect: (tree, t) => {
        t.ok(nvmrc(tree) === 'lts/*\n', 'kept');
        t.ok(said.some((line) => /names no Node major/.test(line)), `reported: ${said}`);
      },
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
        tree.write('.devcontainer/house.Dockerfile', 'FROM mcr.microsoft.com/devcontainers/typescript-node:24\n');
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
