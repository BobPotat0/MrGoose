// Friendly, non-technical labels for the tool-call activity shown in the chat transcripts.
// Keep the UI free of raw tool names like "list_prompts".
const LABELS: Record<string, string> = {
  // session files
  create_file: 'Saving a file', list_files: 'Looking through files', read_file: 'Reading a file',
  // prompt library
  list_prompts: 'Browsing the prompt library', create_prompt: 'Saving a prompt', update_prompt: 'Updating a prompt',
  set_prompt_followups: 'Setting follow-up turns', delete_prompt: 'Deleting a prompt', duplicate_prompt: 'Duplicating a prompt',
  create_folder: 'Creating a folder', list_folders: 'Browsing folders', rename_folder: 'Renaming a folder', delete_folder: 'Deleting a folder', move_prompt: 'Moving a prompt',
  // techniques
  list_techniques: 'Browsing techniques', show_techniques: 'Showing the technique library', create_technique: 'Saving a technique', update_technique: 'Updating a technique', delete_technique: 'Deleting a technique', reset_techniques: 'Restoring built-in techniques',
  list_technique_tags: 'Browsing technique tags', save_technique_tag: 'Saving a tag', delete_technique_tag: 'Deleting a tag',
  // knowledge base
  list_docs: 'Browsing the knowledge base', read_doc: 'Reading a knowledge doc', list_knowledge: 'Reading operator notes', add_knowledge: 'Adding an operator note', delete_knowledge: 'Deleting a note',
  // challenges / scenarios
  list_challenges: 'Browsing challenges', get_challenge: 'Reading a challenge', create_challenge: 'Creating a challenge', update_challenge: 'Updating a challenge', delete_challenge: 'Deleting a challenge',
  create_scenario: 'Adding a scenario', update_scenario: 'Updating a scenario', delete_scenario: 'Deleting a scenario', set_markers: 'Setting markers', list_models: 'Browsing models',
  // recon / verdicts / dossier
  get_dossier: 'Reading the dossier', record_dossier: 'Recording recon', set_verdict: 'Setting a verdict', set_dossier_meta: 'Updating dossier settings',
  delete_dossier_fact: 'Removing a recon fact', delete_dossier_tool: 'Removing a recon tool', delete_dossier_injection: 'Removing an injection',
  list_dossier: 'Reading the dossier', list_injections: 'Reading injections', inspect_injection: 'Inspecting an injection', list_tool_calls: 'Reading tool calls', inspect_tool_call: 'Inspecting a tool call', get_tool: 'Reading a tool',
  record_tool: 'Recording a tool', record_fired_call: 'Recording a tool call', record_filter: 'Recording a filter', record_gate: 'Recording a guardrail', record_system_tag: 'Recording a system tag', record_scenario_recon: 'Recording scenario recon', record_injection: 'Recording an injection',
  // encode / web
  encode: 'Encoding a payload', encode_chain: 'Encoding a payload', list_encoders: 'Listing encoders', web_search: 'Searching the web',
  // arena (page-mediated)
  arena_open_tab: 'Opening an arena tab', arena_fill: 'Filling a field', arena_read: 'Reading the arena', arena_snapshot: 'Reading the arena', arena_pick: 'Picking a field', arena_list_tabs: 'Listing arena tabs', arena_select_tab: 'Switching arena tab', arena_close_tab: 'Closing an arena tab',
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
