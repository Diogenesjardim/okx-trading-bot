// Entrada do pacote usado pela função bot-cycle do Supabase (Deno): mesmo motor do site + configuração.
export { runCycle, initialCloudState } from '../src/lib/cloudCycle';
import config from './config.json';
export const CONFIG = config;
