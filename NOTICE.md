# Notices

## AI Skills Manager

skills-hub is an independent desktop application whose feature set, tool
registry, on-disk conventions and data model are derived from **AI Skills
Manager**, an Obsidian plugin by NoteNerd.

- Source: https://github.com/notenerdofficial/ai-skills-manager
- Licence: MIT

No code was copied: the domain logic here is a fresh implementation in Rust.
What *is* carried over is the design — in particular the set of scanned tools
and their paths, the `SKILL.md`-folder and flat-file item shapes, the
`.skillmanager-disabled` convention for toggling items in place, and the
frontmatter field names used for per-item metadata.

The disabled-folder name and the metadata frontmatter keys are kept identical on
purpose, so the plugin and this application can be used against the same folders
without either having to migrate the other's state.

```
MIT License

Copyright (c) NoteNerd

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Brand marks

The tool icons in `src/toolMeta.ts` are the marks of the products they stand
for, used to name those products in the interface. Each remains the trademark
of its owner; none of them is ours, and their presence implies no endorsement.

Two of them — Claude and Google Gemini — are taken from
[Simple Icons](https://github.com/simple-icons/simple-icons), whose icon files
are released under CC0 1.0. The CC0 waiver covers the icon files, not the
trademarks they depict.
