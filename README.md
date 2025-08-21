# tailwind-picker.nvim

A fast, project-aware Tailwind v3 utility picker for Neovim powered by snacks.nvim.

- Fuzzy search by utility name and CSS declarations
- Accurate CSS preview from your project’s Tailwind config (v3)
- Monorepo-aware (nearest-from-buffer, workspace scan fallback)
- Works with Node and Tailwind in your project; ships a small fallback dataset

## Requirements

- Neovim >= 0.10
- [snacks.nvim](https://github.com/folke/snacks.nvim)
- Node.js in PATH
- Tailwind CSS v3 in your project for project-aware indexing (fallback dataset otherwise)

## Install (lazy.nvim)

```lua
{
  'yourname/tailwind-picker.nvim',
  event = 'VeryLazy',
  dependencies = { 'folke/snacks.nvim' },
  opts = {
    keys = { open = '<leader>ft' },
    scan_depth = 4,
  },
  config = function(_, opts)
    require('tailwind_picker').setup(opts)
  end,
  keys = {
    { '<leader>ft', function() require('tailwind_picker').open() end, desc = 'Tailwind Utility Picker' },
  },
}
```

## Usage

- `:TailwindPicker` — open picker
- `:TailwindPickerRefresh` — rebuild cache
- Enter — copy selected class name(s) to clipboard and close
- Tab — toggle selection (Snacks default)

## Config

```lua
require('tailwind_picker').setup({
  keys = { open = '<leader>ft' }, -- nil to disable default mapping
  scan_depth = 4,                 -- workspace scan depth for fallback discovery
})
```

## How it works

- Resolves Tailwind root by nearest-from-buffer search, otherwise scans workspace
- Builds a per-project cache of classes and per-class CSS using a Node helper
- If Tailwind v3/Node missing, uses bundled fallback list + minimal CSS
- Snacks picker shows class names; preview displays per-class CSS
- Search is fuzzy over both class names and CSS (no cross-field stitching)

## License

Apache-2.0
