local M = {}

local function node_helper_path()
  local base = vim.fn.stdpath('config')
  return table.concat({ base, 'lua', 'tailwind_picker', 'node', 'index.js' }, package.config:sub(1, 1))
end

function M.build_index(root, config_path, cache_dir, cb)
  local args = { 'node', node_helper_path(), '--mode', 'index', '--project', root, '--config', config_path, '--out', cache_dir }
  vim.system(args, { text = true, cwd = root }, function(res)
    cb(res.code == 0, res.code == 0 and '' or (res.stderr ~= '' and res.stderr or res.stdout))
  end)
end

return M
