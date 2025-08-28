local M = {}

local node_available = nil

local function check_node_available()
  if node_available ~= nil then
    return node_available
  end
  
  -- Check if node is available in PATH
  local result = vim.system({ 'node', '--version' }, { text = true }):wait()
  node_available = result.code == 0
  
  if not node_available then
    vim.notify('tailwind-picker: Node.js not found in PATH. Install Node.js for full functionality.', vim.log.levels.WARN)
  end
  
  return node_available
end

local function node_helper_path()
  -- Resolve relative to this module's directory, so it works when installed as a plugin
  local info = debug.getinfo(1, 'S')
  local src = info and info.source or ''
  src = src:gsub('^@', '')
  local dir = vim.fs.dirname(src)
  return vim.fs.joinpath(dir, 'node', 'index.js')
end

function M.build_index(root, config_path, cache_dir, cb)
  if not check_node_available() then
    cb(false, 'Node.js is required but not available in PATH')
    return
  end
  
  local args = { 'node', node_helper_path(), '--mode', 'index', '--project', root, '--config', config_path, '--out', cache_dir }
  vim.system(args, { text = true, cwd = root }, function(res)
    cb(res.code == 0, res.code == 0 and '' or (res.stderr ~= '' and res.stderr or res.stdout))
  end)
end

return M
