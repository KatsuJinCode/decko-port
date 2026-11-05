export type CrudTask = "read" | "create" | "update" | "delete";
export type ViewPermissionDirective = string | readonly string[];

export type ViewPermsResolution =
  | { readonly check: false }
  | { readonly check: true; readonly predicate: false; readonly task: CrudTask }
  | { readonly check: true; readonly predicate: true; readonly task: string };

const PERMS_NONE = new Set<string>([
  "title",
  "title_link",
  "title_no_link",
  "name",
  "key",
  "linkname",
  "url",
  "url_link",
  "link",
  "nav_link",
  "blank",
  "header",
  "header_title",
  "page_title",
  "head",
  "meta_tags",
  "page_title_tag",
  "favicon_tag",
  "rss_links",
  "stylesheet_tags",
  "compact_missing",
  "unknown",
  "server_error",
  "denial",
  "not_found",
  "bad_address",
  "errors",
  "subedits",
  "followed",
  "follower",
  "unfollow_url",
  "flash",
  "javascript_include_tag",
  "javascript_tags",
  "script_calls",
  "script_variables",
  "navbar_links",
  "search_box_complete",
]);

const VIEW_PERMS_DIRECTIVES: Record<string, CrudTask | string> = {
  edit: "update",
  edit_name: "update",
  name_form: "update",
  edit_type: "update",
  edit_type_form: "update",
  edit_inline: "update",
  edit_in_form: "update",
  board: "update",
  comment_box: "update",
  universal_edit_button: "update",
  new: "create",
  new_in_modal: "create",
  simple_new: "create",
  new_fields: "create",
  nest_content: "create",
  new_image: "create",
  configure_button: "can_configure?",
  configure_link: "can_configure?",
};

const CRUD_TASKS: readonly CrudTask[] = ["read", "create", "update", "delete"];

export function createFormOnStoredCard(view: string, isNewCard: boolean | undefined): boolean {
  return isNewCard === false && ["new", "new_in_modal", "simple_new", "new_fields"].includes(view);
}

export function resolveViewPerms(view: string): ViewPermsResolution {
  if (PERMS_NONE.has(view)) return { check: false };
  const directive = Object.hasOwn(VIEW_PERMS_DIRECTIVES, view) ? VIEW_PERMS_DIRECTIVES[view] : undefined;
  if (directive === undefined) {
    return { check: true, predicate: false, task: "read" };
  }
  if ((CRUD_TASKS as readonly string[]).includes(directive)) {
    return { check: true, predicate: false, task: directive as CrudTask };
  }
  return { check: true, predicate: true, task: directive };
}

export function viewPermissionChecks(view: string, declared?: ViewPermissionDirective): readonly Exclude<ViewPermsResolution, {check: false}>[] | null {
  if (declared === undefined) {
    const resolution = resolveViewPerms(view);
    return resolution.check ? [resolution] : null;
  }
  if (declared === "none") return null;
  const tasks = typeof declared === "string" ? [declared] : declared;
  return tasks.map(task => (CRUD_TASKS as readonly string[]).includes(task)
    ? {check: true, predicate: false, task: task as CrudTask}
    : {check: true, predicate: true, task});
}

export type ViewPerms = "read" | "none";

export function viewPerms(view: string): ViewPerms {
  return resolveViewPerms(view).check ? "read" : "none";
}

export function viewRequiresTask(view: string, declared?: ViewPermissionDirective): boolean {
  return viewPermissionChecks(view, declared)?.some(check => !check.predicate && check.task !== "read") === true;
}

export function renderOptSkipPerms(renderOpts: Record<string, unknown>): boolean {
  return renderOpts["skip_perms"] === true;
}

const DENIAL_VIEW = new Map<string, string>([
  ["menu", "blank"],
  ["edit_link", "blank"],
  ["list_of_changes", "blank"],
  ["universal_edit_button", "blank"],
  ["comment_box", "blank"],
  ["configure_button", "blank"],
]);

export function viewDenialView(view: string): string | undefined {
  return DENIAL_VIEW.get(view);
}

export function quietDenial(task = "read"): string {
  return `<span class="denied"><!-- Sorry, you don't have permission (${task}) --></span>`;
}

export interface ViewPermsGateInput {
  readonly declaredPerms?: ViewPermissionDirective;
  readonly declaredDenial?: string;
  readonly renderOpts: Record<string, unknown>;
  readonly isNewCard?: boolean;
  readonly taskAllowed: (task: CrudTask) => boolean | undefined;
  readonly formatName?: string;
  readonly predicateAllowed?: (predicate: string) => boolean | undefined;
}

export function viewPermissionDenial(
  view: string,
  input: ViewPermsGateInput,
): string | undefined {
  return viewPermissionDecision(view, input)?.markup;
}

export function viewPermissionDecision(view: string, input: ViewPermsGateInput): {task: CrudTask | false; markup: string} | undefined {
  const denied = viewDeniedTask(view, input);
  if (denied === undefined) return undefined;
  const deniedLabel = denied.task === false ? "false" : denied.task;
  const blank = (input.declaredDenial ?? viewDenialView(view)) === "blank"
    || (input.formatName !== undefined && input.formatName !== "html");
  return {task: denied.task, markup: blank ? "" : quietDenial(deniedLabel)};
}

export function viewDeniedTask(view: string, input: ViewPermsGateInput): {task: CrudTask | false} | undefined {
  const checks = viewPermissionChecks(view, input.declaredPerms);
  if (checks === null || renderOptSkipPerms(input.renderOpts)) return undefined;
  for (const resolution of checks) {
    if (resolution.predicate) {
      const allowed = input.predicateAllowed?.(resolution.task);
      if (allowed === undefined && input.declaredPerms !== undefined) {
        const error = new Error(`View permission predicate is not implemented: ${resolution.task}`);
        error.name = "UnimplementedViewPermissionPredicateError";
        throw error;
      }
      if (allowed !== false) continue;
      return {task: false};
    } else {
      let task = resolution.task;
      if (task === "update" && input.isNewCard === true) task = "create";
      const allowed = input.taskAllowed(task);
      if (allowed === true || (allowed === undefined && input.declaredPerms === undefined)) {
        if (createFormOnStoredCard(view, input.isNewCard) && input.taskAllowed("update") !== true) return {task: "update"};
        continue;
      }
      return {task: resolution.task};
    }
  }
  return undefined;
}
