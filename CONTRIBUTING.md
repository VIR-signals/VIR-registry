# Contributing to the VIR Registry

[简体中文](CONTRIBUTING.zh-cn.md) | English

Publishing a voice pack here means adding one JSON entry that points to **your own repository** at a frozen commit. The full flow:

## 1. Create your pack repository

Put the pack itself — `manifest.json`, audio files, and optionally `SOURCE.txt` — in your own GitHub repository. The layout follows the VIR Signals voice pack format (one directory holding the manifest and the audio).

## 2. Copy the commit SHA

Copy the **full 40-character** SHA of the commit you want to publish. Users install exactly this commit: anything you push later does not affect published entries. To release a new version, you update your entry with a new SHA.

## 3. Add your entry

Copy [`template.json`](template.json) to `packs/<your-pack-id>.json` and fill in the fields. The filename must equal the `id`. Then rebuild the index locally (plain Node, nothing to install):

```sh
node aggregate.js
```

## 4. Open a pull request

CI runs a triple gate on every PR:

1. **validate** — every entry must pass the checks below;
2. **aggregate** — the index is rebuilt from source entries;
3. **compare** — the rebuild must be byte-identical to the `registry.json` in your PR.

If your PR conflicts with another merged PR, rebase and run `node aggregate.js` again before pushing.

## 5. Merged = listed

Once merged, the entry is live for every user. Note the CDN cache window: `registry.json` served from the branch is cached for roughly 12 hours (a manual purge speeds that up); pack files are fetched by commit SHA and are never affected by caching.

## 6. Removing your pack

Delete your entry file, run `node aggregate.js`, open a PR. Already-installed users keep their local copy. Entries whose repository has died are cleaned up the same way by the maintainers; dead entries are greyed out in the market list but never block it.

## Entry fields

| Field | Required | Rule |
|---|---|---|
| `id` | yes | `^[a-z0-9]+(-[a-z0-9]+)*$`, unique across the registry, **equals the filename** |
| `names` | no | map of lowercase locale (`zh-cn`, `en`, …) to non-empty display name; the client falls back to the id |
| `categories` | no | array of `game` / `ui` / `voice` / `ambient` / `fun` / `other` |
| `language` | yes | `none` or a lowercase BCP-47 tag (`zh`, `en`, …) |
| `version` | yes | three numeric parts, `1.9.0 < 1.10.0` |
| `repo` | yes | `owner/name` of **your own repository** |
| `branch` | yes | non-empty; display hint only — downloads never use it |
| `commit` | yes | full 40-hex SHA; the only download reference |
| `packPath` | yes | forward-slash relative path to `manifest.json` in your repository (usually `pack`) |
| `license` | yes | your pack license |
| `author` | yes | your name |
| `sourceLicense` | yes | one of `original` / `game-asset` / `third-party-cc0` / `unknown` |

Validation checks format only — never taste, quality, or whether a similar pack already exists. Anything format-valid gets accepted; problems are handled by removal.

## What CI rejects, and the reason keys

Run `node validate.js` locally; each violation prints `file: reason-key`. The twelve classes:

| # | Broken class | Reason key(s) |
|---|---|---|
| 1 | id has uppercase / underscore / space | `id.format` |
| 2 | id already used by another entry | `id.duplicate` |
| 3 | filename does not equal the id | `file.stem-mismatch` |
| 4 | repo has a protocol prefix, extra segments, or is empty | `repo.format` |
| 5 | packPath escapes with `..`, uses a backslash, or is absolute | `packPath.escape` / `packPath.backslash` / `packPath.absolute` |
| 6 | commit missing or not 40-hex | `field.required:commit` / `commit.format` |
| 7 | version is not three numeric parts | `version.format` |
| 8 | sourceLicense outside the enum | `sourceLicense.enum` |
| 9 | required field missing or empty | `field.required:<field>` |
| 10 | names locale key invalid or value empty | `names.key-locale` / `names.value-empty` |
| 11 | language uppercase or not a BCP-47 tag | `language.format` |
| 12 | branch empty | `field.required:branch` |

Additional keys you may see: `json.parse` (file is not valid JSON), `entry.not-object` (top level is not an object), `dir.non-json` (a non-JSON file under `packs/`), `names.type` / `categories.type` (`names` or `categories` has the wrong JSON type), `categories.value` (a category outside the enum), `registry.missing` / `registry.schema` / `registry.mismatch` (the generated index is absent, wrong schema, or out of sync with `packs/` — rerun `node aggregate.js`).

## Tests

```sh
node test/run-tests.js
```

covers all twelve bad classes, valid counter-examples, aggregation determinism (byte-identical across runs and independent of file write order), filename/id linkage, the empty-registry shape, and registry consistency.
