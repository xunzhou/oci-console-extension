# OCI Console Enhancer

Chrome/Chromium extension for faster OCI Console navigation.

- Auto-corrects `?region=` when it doesn't match the OCID in the URL
- `Alt+Shift+C` copies the OCID from the current tab (badge flashes ✓)
- Omnibox keyword `o` — examples below

## Omnibox

| Input | Result |
|---|---|
| `o ocid1.instance.oc1.eu-madrid-1.<unique>` | Instance detail page |
| `o <ocid> monitoring` | Specific tab on detail page |
| `o <cluster-ocid> <nodepool-ocid>` | Node pool (child resource) |
| `o instance` | Instance list, last-used region |
| `o vcn phoenix` | VCN list in Phoenix |
| `o instance ashburn prod` | Instance list, Ashburn, compartment matching "prod" |
| `o policy` · `o domain` · `o compartment` | IAM resource lists |
| `o <domain-ocid> <user-ocid>` | User detail (child of domain) |
| `o mybucket ashburn` | Bucket objects page |
| `o tokyo` or `o :tokyo` or `o nrt` | Switch current page to Tokyo |
| `o >prod` | Switch current page to compartment matching "prod" |
| *(empty)* | Recent regions + navigation history |
| `o ?` | Quick syntax reference |

Open **Settings** to paste a compartment list (`oci iam compartment list --all`) for name-based filtering.

## Installation

1. Clone or download this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the project directory.

The `Alt+Shift+C` shortcut can be rebound at `chrome://extensions/shortcuts`.

## License

MIT — see [LICENSE](LICENSE).
