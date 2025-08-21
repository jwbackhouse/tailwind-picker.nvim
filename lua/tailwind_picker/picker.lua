local M = {}

local uv = vim.uv or vim.loop

local function join_paths(...)
  return table.concat({ ... }, package.config:sub(1, 1))
end

local function path_exists(path)
  return uv.fs_stat(path) ~= nil
end

local resolve = require('tailwind_picker.resolve')
local node = require('tailwind_picker.node')

local function read_file(path)
  local fd = assert(uv.fs_open(path, 'r', 438))
  local stat = assert(uv.fs_fstat(fd))
  local data = assert(uv.fs_read(fd, stat.size, 0))
  uv.fs_close(fd)
  return data
end

local function get_cache_dir(root)
  local cache_root = join_paths(vim.fn.stdpath('cache'), 'tailwind-picker')
  vim.fn.mkdir(cache_root, 'p')
  local hash = vim.fn.sha256(root)
  local dir = join_paths(cache_root, hash)
  vim.fn.mkdir(dir, 'p')
  return dir
end

local function is_cache_stale(config_path, cache_dir)
  local class_list = join_paths(cache_dir, 'classes.json')
  local map_file = join_paths(cache_dir, 'filename-map.json')
  if not (path_exists(class_list) and path_exists(map_file)) then
    return true
  end
  local cfg_stat = uv.fs_stat(config_path)
  local cls_stat = uv.fs_stat(class_list)
  if not cfg_stat or not cls_stat then
    return true
  end
  return cfg_stat.mtime.sec > cls_stat.mtime.sec
end

local function open_picker_with_cache(cache_dir)
  local classes_path = join_paths(cache_dir, 'classes.json')
  local map_path = join_paths(cache_dir, 'filename-map.json')
  local ok1, classes_json = pcall(read_file, classes_path)
  local ok2, map_json = pcall(read_file, map_path)
  if not (ok1 and ok2) then
    Snacks.notify('tailwind-picker: cache missing or unreadable', { level = 'error' })
    return
  end
  local _ = vim.json.decode(classes_json)
  local fname_to_class = vim.json.decode(map_json)

  local function finder()
    local items = {}
    for key, klass in pairs(fname_to_class) do
      local file = join_paths(cache_dir, key .. '.css')
      if path_exists(file) then
        local css = ''
        local ok_css, content = pcall(read_file, file)
        if ok_css and type(content) == 'string' then
          css = content:gsub('%s+', ' ')
          if #css > 300 then
            css = css:sub(1, 300)
          end
        end
        table.insert(items, { text = klass .. ' ' .. css, class = klass, file = file })
      end
    end
    table.sort(items, function(a, b)
      return a.text < b.text
    end)
    return items
  end

  Snacks.picker.pick {
    source = 'tailwind_classes',
    title = 'Tailwind v3 Utilities',
    finder = finder,
    preview = 'file',
    format = function(item)
      return { { item.class or item.text } }
    end,
    actions = {
      confirm = function(picker)
        local items = picker:selected { fallback = true }
        local selected = {}
        for _, it in ipairs(items) do
          table.insert(selected, it.class or it.text)
        end
        local text = table.concat(selected, ' ')
        pcall(vim.fn.setreg, '+', text)
        Snacks.notify('Copied classes to clipboard', { level = 'info' })
        picker:close()
      end,
    },
  }
end

function M.open()
  resolve.resolve_project_and_config(function(root, cfg)
    local cache_dir = get_cache_dir(root)
    if is_cache_stale(cfg, cache_dir) then
      Snacks.notify('tailwind-picker: building index…', { level = 'info' })
      node.build_index(root, cfg, cache_dir, function(success, msg)
        vim.schedule(function()
          if not success then
            Snacks.notify('tailwind-picker: index failed: ' .. (msg or ''), { level = 'error' })
            return
          end
          Snacks.notify('tailwind-picker: index ready', { level = 'info' })
          open_picker_with_cache(cache_dir)
        end)
      end)
    else
      open_picker_with_cache(cache_dir)
    end
  end)
end

function M.refresh()
  resolve.resolve_project_and_config(function(root, cfg)
    local cache_dir = get_cache_dir(root)
    Snacks.notify('tailwind-picker: rebuilding index…', { level = 'info' })
    node.build_index(root, cfg, cache_dir, function(success, msg)
      vim.schedule(function()
        if not success then
          Snacks.notify('tailwind-picker: index failed: ' .. (msg or ''), { level = 'error' })
          return
        end
        Snacks.notify('tailwind-picker: index rebuilt', { level = 'info' })
      end)
    end)
  end)
end

function M.setup(opts)
  opts = opts or {}
  local open_key = opts.keys and opts.keys.open or '<leader>ft'
  if open_key and open_key ~= '' then
    vim.keymap.set('n', open_key, function()
      M.open()
    end, { desc = 'Tailwind Utility Picker' })
  end
  resolve.set_scan_depth(opts.scan_depth or 4)
end

return M
