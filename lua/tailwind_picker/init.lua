local M = {}

local picker = require('tailwind_picker.picker')

function M.setup(opts)
  picker.setup(opts or {})
end

function M.open()
  picker.open()
end

function M.refresh()
  picker.refresh()
end

return M
