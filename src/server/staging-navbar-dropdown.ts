export type NavbarDropdownChild =
  | {readonly kind: "divider"}
  | {readonly kind: "link"; readonly target: string; readonly label: string}
  | {readonly kind: "external"; readonly target: string; readonly label: string};

export const NAVBAR_READ_DENIED_SPAN = `<span class="denied"><!-- Sorry, you don't have permission (read) --></span>`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function navbarUrlKey(target: string): string {
  return target.replace(/ /g, "_").replace(/\$/g, "_");
}

export async function renderNavbarDropdownItems(
  children: readonly NavbarDropdownChild[],
  canRead: (target: string) => Promise<boolean>,
): Promise<string> {
  const items: string[] = [];
  for (const child of children) {
    if (child.kind === "divider") {
      items.push(`<div class="dropdown-divider"></div>`);
    } else if (child.kind === "external") {
      continue;
    } else if (!(await canRead(child.target))) {
      items.push(NAVBAR_READ_DENIED_SPAN);
    } else {
      items.push(
        `<a class="dropdown-item known-card" href="/${escapeHtml(navbarUrlKey(child.target))}"><span class="card-title" title="${escapeHtml(child.target)}">${escapeHtml(child.label)}</span></a>`,
      );
    }
  }
  return items.join("\n");
}
