local M = {}

local uv = vim.uv or vim.loop

local scan_depth = 4

function M.set_scan_depth(d)
  scan_depth = d or 4
end

local function find_nearest_config_from_buffer()
  local buf = vim.api.nvim_get_current_buf()
  local buf_name = vim.api.nvim_buf_get_name(buf)
  local start = buf_name ~= '' and vim.fs.dirname(buf_name) or vim.loop.cwd()
  local names = { 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts' }
  local found = vim.fs.find(names, { upward = true, path = start, type = 'file' })
  if found and #found > 0 then
    return found[1]
  end
  return nil
end

local function workspace_scan_configs(cwd, max_depth)
  max_depth = max_depth or scan_depth
  local ignore = { ['.git'] = true, ['node_modules'] = true, ['dist'] = true, ['build'] = true }
  local results = {}

  local function scan(dir, depth)
    if depth > max_depth then
      return
    end
    local req = uv.fs_scandir(dir)
    if not req then
      return
    end
    while true do
      local name, t = uv.fs_scandir_next(req)
      if not name then
        break
      end
      if name == '.' or name == '..' then
        goto continue
      end
      local full = dir .. package.config:sub(1, 1) .. name
      if t == 'file' then
        if name:match '^tailwind%.config%.[cmjt]s$' then
          results[#results + 1] = full
        end
      elseif t == 'directory' and not ignore[name] then
        scan(full, depth + 1)
      end
      ::continue::
    end
  end

  scan(cwd, 1)
  return results
end

function M.resolve_project_and_config(on_resolve)
  local cfg = find_nearest_config_from_buffer()
  if cfg then
    return on_resolve(vim.fs.dirname(cfg), cfg)
  end
  local cwd = vim.loop.cwd()
  local found = workspace_scan_configs(cwd, scan_depth)
  if #found == 0 then
    Snacks.notify('tailwind-picker: no tailwind.config.* found', { level = 'error' })
    return
  elseif #found == 1 then
    return on_resolve(vim.fs.dirname(found[1]), found[1])
  end

  local items = {}
  for _, p in ipairs(found) do
    local rel = vim.fs.normalize(p):gsub('^' .. vim.pesc(cwd) .. '/', '')
    table.insert(items, { text = rel, file = p, path = p })
  end

  Snacks.picker.pick {
    source = 'tailwind_configs',
    title = 'Select Tailwind Config',
    items = items,
    actions = {
      confirm = function(picker, sel)
        local it = sel[1]
        picker:close()
        on_resolve(vim.fs.dirname(it.file), it.file)
      end,
    },
  }
end

return M
