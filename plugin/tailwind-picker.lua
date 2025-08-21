if vim.g.loaded_tailwind_picker then
  return
end
vim.g.loaded_tailwind_picker = true

vim.api.nvim_create_user_command('TailwindPicker', function()
  require('tailwind_picker').open()
end, {})

vim.api.nvim_create_user_command('TailwindPickerRefresh', function()
  require('tailwind_picker').refresh()
end, {})
