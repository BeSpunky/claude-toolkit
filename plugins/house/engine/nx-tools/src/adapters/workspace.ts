// WHICH STACKS THIS WORKSPACE WEARS — the adapter registry read against the layer registry.
//
// "The most specific stack whose layer is present and which has port X" is a question four generators asked,
// each in its own words (the stack that creates the first app, binds a new design system, defines the server
// import firewall, creates a library by default). It lives here, ONCE, and in its own module for a structural
// reason: the adapter registry must not import the layer registry — layer descriptors import the adapter
// registry (the web layer recognises dev-servers through it), and the reverse edge made the two a cycle.
import type { Tree } from '@nx/devkit';
import { ADAPTERS, type Port, type StackAdapter } from './registry';
import { isPresent } from '../layers/registry';

/** A stack that is known to have `port`. */
export type StackWith<P extends Port> = StackAdapter & { readonly [K in P]-?: NonNullable<StackAdapter[K]> };

/** Every stack this workspace wears (its layer is present) that has `port`, most specific first. */
export function workspaceStacksWith<P extends Port>(tree: Tree, port: P): StackWith<P>[] {
  return ADAPTERS.filter((stack): stack is StackWith<P> => Boolean(stack[port]) && isPresent(tree, stack.layer));
}

/** The most specific stack this workspace wears that has `port` — or null when none does. */
export function workspaceStackWith<P extends Port>(tree: Tree, port: P): StackWith<P> | null {
  return workspaceStacksWith(tree, port)[0] ?? null;
}
