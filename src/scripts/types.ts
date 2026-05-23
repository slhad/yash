// Convention type for yash scripts.
// Scripts register their actions as side effects via registry.registerAction().
// Load a script by adding a side-effect import: import './scripts/my-script'
import type { YashActionDefinition } from '../actions/types';

export type ScriptDefinition = {
  id: string;
  name: string;
  description: string;
  actions: YashActionDefinition[];
};
