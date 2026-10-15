# MindScribe project instructions

## Required GitHub synchronization

The owner requested on 2026-10-15 that every subsequent project change also be saved to their GitHub repository. This is a standing instruction, not an optional backup.

- Keep the application hosted on its existing Sites project: appgprj_6aca6f8c214c819190ac8e842980d8cb.
- The owner explicitly authorized replacing the old repository contents on 2026-10-15. Synchronization destination: https://github.com/cermmid/MindScribeCodex, default branch `claude/laughing-franklin-AddB0`. Preserve past commits; replace the working tree, not Git history.
- Once configured, synchronize all tracked source changes to that GitHub repository on every update, including configuration, migrations, tests, and these instructions. Verify the resulting GitHub commit and branch before claiming synchronization succeeded.
- Use the supported Sites source workflow for Sites and the authorized GitHub connector or authenticated Git workflow for GitHub. Do not replace the Sites source remote.
- Never copy credentials, runtime secrets, .env files, recordings, visit data, database contents, node_modules, or generated build output into GitHub. Inspect tracked source before the initial upload.
- If synchronization fails or destination access is unavailable, explicitly report that GitHub is not up to date. Do not imply a continuous automatic mirror exists: this instruction requires synchronization during each editing task.

## Public-facing wording

Do not attribute the app, prompts, or documentation style to named private individuals in product copy. Keep wording neutral. This does not remove legitimate signed-in identity labels or user-owned visit content.
