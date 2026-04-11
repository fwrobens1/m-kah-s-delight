--// Wait for game to load \\--
if not game:IsLoaded() then
    game.Loaded:Wait()
end

--// Variables \\--
local BridgeURL = getgenv().BridgeURL or ... or "localhost:16384"

--// Libraries \\--

-- Regex Engine (native Regex class if available, otherwise LuauRegExp)
local RegexEngine = {}
do
    if Regex then
        function RegexEngine.compile(pattern, isLiteral, caseSensitive)
            if isLiteral then pattern = Regex.Escape(pattern) end
            if not caseSensitive then pattern = "(?i)" .. pattern end
            local ok, re = pcall(Regex.new, pattern)
            if not ok then return nil, tostring(re) end
            return re, nil
        end

        function RegexEngine.matchLine(re, line)
            return re:Match(line) ~= nil
        end
    else
        local RegExp = loadstring(game:HttpGet("https://raw.githubusercontent.com/notpoiu/LuauRegExp/refs/heads/main/dist/RegExp.luau"))()
        local Regexp = RegExp.Regexp

        function RegexEngine.compile(pattern, isLiteral, caseSensitive)
            local flags = Regexp.LikePerl
            if isLiteral then flags = bit32.bor(flags, Regexp.Literal) end
            if not caseSensitive then flags = bit32.bor(flags, Regexp.FoldCase) end
            local status = Regexp.newStatus()
            local re = Regexp.Parse(pattern, flags, status)
            if re == nil then return nil, status:Text() end
            return re, nil
        end

        function RegexEngine.matchLine(re, line)
            local ok = re:IsMatch(line)
            return ok == true
        end
    end
end

-- Lua 5.1+ base64 v3.0 (c) 2009 by Alex Kloss <alexthkloss@web.de>
-- licensed under the terms of the LGPL2

-- character table string
local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

-- encoding
function base64_encode(data)
    return ((data:gsub('.', function(x) 
        local r,b='',x:byte()
        for i=8,1,-1 do r=r..(b%2^i-b%2^(i-1)>0 and '1' or '0') end
        return r;
    end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
        if (#x < 6) then return '' end
        local c=0
        for i=1,6 do c=c+(x:sub(i,i)=='1' and 2^(6-i) or 0) end
        return b:sub(c+1,c+1)
    end)..({ '', '==', '=' })[#data%3+1])
end

--// Functions \\--
local function CreateDecompileFunction(id, options)
    local Endpoint = options.Endpoint
    local EncodingCallback = options.EncodeBytecode or function(x) return x end
    local FailedRequestCallback = options.FailedRequestCallback or function(httpResult) return `-- Failed to decompile, error:\n\n--[[\n{httpResult}\n--]]` end

    return function(scriptPath: Script | ModuleScript | LocalScript): string
        local okBytecode: boolean, bytecode: string = pcall(getscriptbytecode, scriptPath)

        if not okBytecode then
            return `-- Failed to get script bytecode, error:\n\n--[[\n{bytecode}\n--]]`
        end

        local okRequest: boolean, httpResult = pcall(request, {
            Url = Endpoint,
            Method = "POST",
            Body = EncodingCallback(bytecode),
            Headers = {
                ["Content-Type"] = "text/plain"
            },
        })

        if not okRequest then
            return FailedRequestCallback(httpResult, scriptPath)
        end

        if httpResult.StatusCode ~= 200 then
            return FailedRequestCallback(httpResult, scriptPath)
        end

        return `-- Decompiled with {id}\n{string.gsub(httpResult.Body, string.char(0x00CD), " ")}`
    end
end

local LuaEncode = loadstring(game:HttpGet("https://raw.githubusercontent.com/chadhyatt/LuaEncode/refs/heads/master/src/LuaEncode.lua"))()
local cloneref = cloneref or function(x) return x end

local KonstantDecompile = CreateDecompileFunction("Konstant", { Endpoint = "http://api.plusgiant5.com/konstant/decompile" })
local decompile = decompile or CreateDecompileFunction("Medal", {
    Endpoint = "https://medal.upio.dev/decompile",
    EncodingCallback = base64_encode,
    FailedRequestCallback = function(_, path)
        return KonstantDecompile(path)
    end
})
local getnilinstances = getnilinstances or function() return {} end
local getscriptbytecode = getscriptbytecode or function(x) error("Unable to get script bytecode.") end

--// Services \\--
local RobloxReplicatedStorage = cloneref(game:GetService("RobloxReplicatedStorage"))
local VirtualInputManager = cloneref(Instance.new("VirtualInputManager"))
local MarketplaceService = cloneref(game:GetService("MarketplaceService"))
local CoreGui = cloneref(game:GetService("CoreGui"))
local CorePackages = cloneref(game:GetService("CorePackages"))
local HttpService = cloneref(game:GetService("HttpService"))
local LogService = cloneref(game:GetService("LogService"))
local Players = cloneref(game:GetService("Players"))

--// Compatibility Check \\--
local WebSocketAvailable = (
    typeof(WebSocket) ~= "nil" and
    typeof(WebSocket.connect) == "function"
) and (getgenv().DisableWebSocket ~= true)

--// Registration Info \\--
local function GetRegistrationInfo()
    local player = Players.LocalPlayer
    local placeName = "Unknown"
    pcall(function()
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)
        placeName = productInfo.Name
    end)
    return {
        type = "register",
        username = player and player.Name or "Unknown",
        userId = player and player.UserId or 0,
        placeId = game.PlaceId,
        jobId = game.JobId,
        placeName = placeName,
    }
end

--// Base Bridge Class \\--
local BaseBridge = {}; do
    BaseBridge.__index = BaseBridge
    
    function BaseBridge:BindToType(type, callback)
        self.Callbacks[type] = callback
    end

    function BaseBridge:BindToTypeRaw(type, callback)
        self.Callbacks[type] = callback
        self.RawCallbacks = self.RawCallbacks or {}
        self.RawCallbacks[type] = true
    end

    function BaseBridge:CreateAlias(type, aliases)
        for _, alias in aliases do
            self.Callbacks[alias] = self.Callbacks[type]
            if self.RawCallbacks and self.RawCallbacks[type] then
                self.RawCallbacks[alias] = true
            end
        end
    end

    function BaseBridge:HandleMessage(data)
        if self.Callbacks[data.type] then
            local success, result = pcall(function()
                return self.Callbacks[data.type](data)
            end)

            if success and result == nil then
                return nil
            end

            if not success then
                return self:FormatResponse(result, data.id, true)
            end

            if self.RawCallbacks and self.RawCallbacks[data.type] then
                return {
                    output = tostring(result),
                    success = true,
                    id = data.id
                }
            end

            return self:FormatResponse(result, data.id, false)
        end
        return nil
    end
    
    function BaseBridge:FormatResponse(message, id, isError)
        if isError then
            return {
                error = tostring(message),
                success = false,
                id = id
            }
        end
        
        local output = message
        if typeof(output) ~= "table" then
            output = { output }
        end
    
        return {
            output = LuaEncode(output, {
                Prettify = true
            }),
            success = true,
            id = id
        }
    end
    
    function BaseBridge:IsAlive()
        local success, result = pcall(function()
            local response
            local thread = task.spawn(function()
                local success, data = pcall(request, {
                    Url = "http://" .. BridgeURL,
                    Method = "GET"
                })

                if success then
                    response = data
                end
            end)

            local start = os.clock()
            repeat task.wait(0.05) until response ~= nil or os.clock() - start > 5

            if response == nil then
                task.cancel(thread)
                return false
            end
    
            -- 426 = Upgrade Required (WebSocket), 200 = HTTP mode
            if response.StatusCode == 426 or response.StatusCode == 200 then
                return true
            end
    
            return false
        end)
    
        if not success then
            return false
        end
    
        return result
    end
end

--// WebSocket Bridge \\--
local WebSocketBridge = setmetatable({}, {__index = BaseBridge}); do
    WebSocketBridge.__index = WebSocketBridge
    
    function WebSocketBridge.new()
        local self = setmetatable({}, WebSocketBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        --// Connect to the server with timeout \\--
        local wsConnection = nil
        local connectionThread = task.spawn(function()
            local success, result = pcall(function()
                return WebSocket.connect("ws://" .. BridgeURL)
            end)
            if success then
                wsConnection = result
            end
        end)
        
        local connectionStart = os.clock()
        repeat task.wait(0.05) until wsConnection ~= nil or os.clock() - connectionStart > 5
        
        if wsConnection == nil then
            task.cancel(connectionThread)
            error("WebSocket connection timed out after 5 seconds")
        end
        
        self.WebSocket = wsConnection
        self.Connected = true
        self.Callbacks = {}
        self.ClientId = nil

        --// Send registration \\--
        self.WebSocket:Send(HttpService:JSONEncode(GetRegistrationInfo()))

        self.AliveThread = task.spawn(function()
            while task.wait(1) do
                if self:IsAlive() or not self.Connected then
                    continue
                end
                
                self.Connected = false
                break
            end
    
            pcall(function()
                self.WebSocket:Close()
            end)
        end)
    
        --// On Message \\--
        self.WebSocket.OnMessage:Connect(function(message)
            local data = HttpService:JSONDecode(message)

            --// Handle registration response \\--
            if data.type == "registered" then
                self.ClientId = data.clientId
                return
            end

            local response = self:HandleMessage(data)
            if response then
                self.WebSocket:Send(HttpService:JSONEncode(response))
            end
        end)
    
        --// On Close \\--
        self.WebSocket.OnClose:Connect(function()
            self.Connected = false
        end)
    
        return self
    end
    
    function WebSocketBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// HTTP Polling Bridge \\--
local HTTPBridge = setmetatable({}, {__index = BaseBridge}); do
    HTTPBridge.__index = HTTPBridge
    
    function HTTPBridge.new()
        local self = setmetatable({}, HTTPBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        self.Connected = true
        self.Callbacks = {}
        self.PollInterval = 0.1
        self.ClientId = nil

        --// Register with the server \\--
        pcall(function()
            local regResponse = request({
                Url = "http://" .. BridgeURL .. "/register",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode(GetRegistrationInfo()),
            })
            if regResponse.StatusCode == 200 and regResponse.Body then
                local regData = HttpService:JSONDecode(regResponse.Body)
                self.ClientId = regData.clientId
            end
        end)
    
        --// Start polling thread \\--
        self.PollThread = task.spawn(function()
            local consecutiveFailures = 0
            
            while self.Connected do
                local success, _ = pcall(function()
                    local pollUrl = "http://" .. BridgeURL .. "/poll"
                    if self.ClientId then
                        pollUrl = pollUrl .. "?clientId=" .. self.ClientId
                    end
                    local response = request({
                        Url = pollUrl,
                        Method = "GET"
                    })

                    --// Server might be down \\--
                    if response.StatusCode ~= 204 and response.StatusCode ~= 200 then
                        consecutiveFailures += 1
                        if consecutiveFailures >= 3 then
                            self.Connected = false
                        end

                        return
                    end
                    
                    consecutiveFailures = 0
    
                    --// Handle response \\--
                    if response.Body and response.Body ~= "" then
                        local data = HttpService:JSONDecode(response.Body)
                        if data == nil or data.type == nil then return end
                        
                        local result = self:HandleMessage(data)
                        if result == nil then return end
                        
                        --// Send response back \\--
                        request({
                            Url = "http://" .. BridgeURL .. "/respond",
                            Method = "POST",
                            Headers = {
                                ["Content-Type"] = "application/json"
                            },
                            Body = HttpService:JSONEncode(result)
                        })
                    end
                end)
    
                if not success then
                    consecutiveFailures += 1
                    if consecutiveFailures >= 3 then
                        self.Connected = false
                    end
                end
    
                task.wait(self.PollInterval)
            end
        end)
    
        return self
    end
    
    function HTTPBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// Create Bridge \\--
local function CreateBridge()
    if WebSocketAvailable then
        local success, bridge = pcall(function()
            return WebSocketBridge.new()
        end)
        
        if success then
            return bridge
        end
    end

    return HTTPBridge.new()
end

--// Script Source Mapping \\--
local ScriptSourcesMap = {
    HasFinishedMapping = false
}

local ScriptInstanceMap = setmetatable({}, { __mode = "v" })
local SourcesToMap, MappedSources = 0, 0
local HasStartedMapping = false

local function MapScriptSource(script)
    local debugId = script:GetDebugId()
    if ScriptSourcesMap[debugId] then return end

    for attempt = 1, 10 do
        local success, decompOutput = pcall(decompile, script)
        if not success then
            task.wait(0.5)
            continue
        end
    
        ScriptSourcesMap[debugId] = decompOutput
        MappedSources += 1
        break
    end

    ScriptInstanceMap[debugId] = script
    script.Destroying:Once(function()
        ScriptInstanceMap[debugId] = nil
    end)
end

local function GetScriptByDebugId(debugId)
    local CachedInstance = ScriptInstanceMap[debugId]
    if CachedInstance then
        return CachedInstance
    end

    for _, script in game:QueryDescendants("LuaSourceContainer") do
        if script:IsA("Script") and script.RunContext == Enum.RunContext.Server then continue end
        if script:GetDebugId() ~= debugId then continue end
        
        ScriptInstanceMap[debugId] = script
        return script
    end

    for _, script in getnilinstances() do
        if not script:IsA("LuaSourceContainer") then continue end

        if script:IsA("Script") and script.RunContext ~= Enum.RunContext.Client then continue end
        if script:GetDebugId() ~= debugId then continue end
        
        ScriptInstanceMap[debugId] = script
        return script
    end

    return nil
end

local function ShouldMapScript(script)        
    local IsServerScript = script:IsA("Script") and script.RunContext == Enum.RunContext.Server
    if IsServerScript then return false end

    local IsRobloxScript = script.RobloxLocked or script:IsDescendantOf(CoreGui) or script:IsDescendantOf(CorePackages)
    if IsRobloxScript then return false end

    local IsAlreadyMapped = ScriptSourcesMap[script:GetDebugId()]
    if IsAlreadyMapped then return false end

    local HasBytecode = pcall(getscriptbytecode, script)
    if not HasBytecode then return false end

    return true
end

local function StartScriptMapping()
    if HasStartedMapping then return end
    HasStartedMapping = true

    game.DescendantAdded:Connect(function(script)
        if not script:IsA("LuaSourceContainer") then
            return
        end

        if not ShouldMapScript(script) then return end
        MapScriptSource(script)
    end)

    local CategoriesToMap = {
        game:QueryDescendants("LuaSourceContainer"),
        getnilinstances()
    }

    --// Map script sources \\--
    task.spawn(function()
        local ValidScripts = {}
        for _, category in CategoriesToMap do
            for _, script in category do
                if not script:IsA("LuaSourceContainer") then continue end
                if not ShouldMapScript(script) then continue end

                table.insert(ValidScripts, script)
            end
        end

        SourcesToMap = #ValidScripts

        for idx, scriptObject in ValidScripts do
            task.defer(MapScriptSource, scriptObject)
            if idx % 250 == 0 then task.wait(0.1) end
        end

        ScriptSourcesMap.HasFinishedMapping = true
    end)
end

--// Start mapping immediately unless disabled \\--
if not getgenv().DisableInitialScriptDecompMapping then
    StartScriptMapping()
end

--// Main Loop \\--
while true do
    local success, Bridge = pcall(CreateBridge)
    
    if not success then
        task.wait(3)
        continue
    end

    Bridge:BindToType("execute", function(data)
        setthreadidentity(8)
        loadstring(data.source)()
    end)

    Bridge:BindToType("get-console-output", function(data)
        local limit = data.limit or 50
        local logsOrder = data.logsOrder or "NewestFirst"

        local logs = LogService:GetLogHistory()
        local results = {}
        
        if logsOrder == "NewestFirst" then
            for i = #logs, 1, -1 do
                if #results >= limit then break end
                table.insert(results, logs[i])
            end
        else
            for _, log in logs do
                if #results >= limit then break end
                table.insert(results, log)
            end
        end

        return { count = #LogService:GetLogHistory(), limited = #LogService:GetLogHistory() > limit, results = results }
    end)

    Bridge:BindToType("get-data-by-code", function(data)
        setthreadidentity(8)
        local dataOutput = table.pack(loadstring(data.source)())

        return dataOutput
    end)

    Bridge:BindToTypeRaw("get-script-content", function(data)
        local source

        --// Handle GC'd script proxies: debugId is passed directly, skip loadstring \\--
        if data.debugId then
            source = ScriptSourcesMap[data.debugId]
            assert(source, "No cached source found for GC'd ScriptProxy with DebugId: " .. tostring(data.debugId))
        else
            setthreadidentity(8)
            local scriptInstance = loadstring(data.source)()

            assert(typeof(scriptInstance) == "Instance", "Script instance is not an instance.")
            assert(scriptInstance:IsA("LuaSourceContainer"), "Script instance is not a LuaSourceContainer (Script, LocalScript, or ModuleScript).")
            assert(not (scriptInstance:IsA("Script") and scriptInstance.RunContext == Enum.RunContext.Server), "Script instance is a Server Script.")

            if not ScriptSourcesMap[scriptInstance:GetDebugId()] then
                MapScriptSource(scriptInstance)
            end

            source = ScriptSourcesMap[scriptInstance:GetDebugId()]
        end

        --// Line range support \\--
        if data.startLine then
            local lines = {}
            local pos = 1
            local len = #source
            while pos <= len do
                local newlinePos = source:find("\n", pos, true)
                if newlinePos then
                    table.insert(lines, source:sub(pos, newlinePos - 1))
                    pos = newlinePos + 1
                else
                    table.insert(lines, source:sub(pos))
                    break
                end
            end

            local totalLines = #lines
            local startLine = math.max(1, math.min(data.startLine, totalLines))
            local endLine = data.endLine and math.max(startLine, math.min(data.endLine, totalLines)) or totalLines

            local sliced = {}
            for i = startLine, endLine do
                table.insert(sliced, lines[i])
            end

            return "-- Lines " .. startLine .. "-" .. endLine .. " of " .. totalLines .. "\n" .. table.concat(sliced, "\n")
        end

        return source
    end)

    Bridge:BindToType("search-instances", function(data)
        local rootInstance = loadstring("return " .. data.root)()
        local instances = rootInstance:QueryDescendants(data.selector)
        
        local limit = data.limit or 50
        local results = {}
        
        for i, instance in instances do
            if i > limit then break end

            table.insert(results, {
                Name = instance.Name,
                ClassName = instance.ClassName,
                InstancePath = instance,
                DebugId = instance:GetDebugId()
            })
        end
        
        return {
            count = #instances,
            limited = #instances > limit,
            results = results
        }
    end)

    Bridge:BindToType("get-game-info", function(data)
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)
        
        return {
            PlaceId = game.PlaceId,
            GameId = game.GameId,
            PlaceVersion = game.PlaceVersion,
            PlaceName = productInfo.Name,
            PlaceDescription = productInfo.Description,
            Creator = productInfo.Creator.Name,
            CreatorType = tostring(productInfo.Creator.CreatorType),
            CreatorId = productInfo.Creator.CreatorTargetId,
            JobId = game.JobId,
            ServerType = RobloxReplicatedStorage.GetServerType:InvokeServer()
        }
    end)

    Bridge:BindToType("get-descendants-tree", function(data)
        local rootInstance = loadstring("return " .. data.root)()
        assert(typeof(rootInstance) == "Instance", "Root path did not resolve to a valid Instance.")

        local maxDepth = data.maxDepth or 3
        local maxChildren = data.maxChildren or 50
        local classFilter = data.classFilter or ""
        local hasFilter = classFilter ~= ""

        local function buildTree(instance, depth)
            if depth > maxDepth then
                return nil
            end

            local children = instance:GetChildren()
            local childNodes = {}
            local shown = 0
            local total = #children

            for _, child in children do
                if shown >= maxChildren then break end

                if hasFilter and not child:IsA(classFilter) then
                    -- Even if this child doesn't match, check if any descendant might
                    -- Only skip if we're at max depth anyway
                    if depth < maxDepth then
                        local subtree = buildTree(child, depth + 1)
                        if subtree and subtree.Children and #subtree.Children > 0 then
                            table.insert(childNodes, subtree)
                            shown += 1
                        end
                    end
                    continue
                end

                local node = {
                    Name = child.Name,
                    ClassName = child.ClassName,
                    ChildCount = #child:GetChildren()
                }

                if depth < maxDepth and node.ChildCount > 0 then
                    local subtree = buildTree(child, depth + 1)
                    if subtree then
                        node.Children = subtree.Children
                    end
                end

                table.insert(childNodes, node)
                shown += 1
            end

            return {
                Name = instance.Name,
                ClassName = instance.ClassName,
                ChildCount = total,
                TruncatedAt = if shown < total then shown else nil,
                Children = childNodes
            }
        end

        return buildTree(rootInstance, 0)
    end)

    Bridge:BindToType("ensure-remote-spy", function(data)
        if getgenv().Cobalt then
            return {
                status = "already_loaded",
                message = "Cobalt remote spy is already running."
            }
        end

        -- Load Cobalt
        local success, err = pcall(function()
            loadstring(game:HttpGet("https://github.com/notpoiu/cobalt/releases/latest/download/Cobalt.luau"))()
        end)

        if not success then
            error("Failed to load Cobalt: " .. tostring(err))
        end

        -- Wait for Cobalt to initialize
        local waitStart = os.clock()
        while not getgenv().Cobalt and os.clock() - waitStart < 10 do
            task.wait(0.1)
        end
        
        return {
            status = "loaded",
            message = "Cobalt remote spy loaded successfully."
        }
    end)

    Bridge:BindToType("get-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local direction = data.direction or "Both"
        local nameFilter = data.remoteNameFilter or ""
        local limit = data.limit or 50
        local maxCallsPerRemote = data.maxCallsPerRemote or 5
        local hasNameFilter = nameFilter ~= ""

        local function ProcessLogs(logTable, directionLabel)
            local results = {}

            for instance, log in logTable do
                if typeof(instance) ~= "Instance" then continue end
                if #results >= limit then break end

                local remoteName = ""
                local remoteClass = ""
                pcall(function()
                    remoteName = instance.Name
                    remoteClass = instance.ClassName
                end)

                -- Apply name filter
                if hasNameFilter and not string.find(string.lower(remoteName), string.lower(nameFilter), 1, true) then
                    continue
                end

                -- Get recent calls (raw — LuaEncode handles serialization)
                local recentCalls = {}
                local totalCalls = #log.Calls
                local startIdx = math.max(1, totalCalls - maxCallsPerRemote + 1)

                for i = startIdx, totalCalls do
                    local call = log.Calls[i]
                    if not call then continue end

                    table.insert(recentCalls, {
                        Index = i,
                        Arguments = call.Arguments,
                        Origin = call.Origin,
                        IsExecutor = call.IsExecutor or false,
                        IsActor = call.IsActor or false,
                        Line = call.Line,
                    })
                end

                table.insert(results, {
                    RemoteName = remoteName,
                    RemoteClass = remoteClass,
                    Direction = directionLabel,
                    Method = log.Method,
                    TotalCalls = totalCalls,
                    Ignored = log.Ignored,
                    Blocked = log.Blocked,
                    RecentCalls = recentCalls,
                })
            end

            return results
        end

        local allResults = {}

        if direction == "Outgoing" or direction == "Both" then
            local outgoing = ProcessLogs(Cobalt.shared.Logs.Outgoing, "Outgoing")
            for _, r in outgoing do
                table.insert(allResults, r)
            end
        end

        if direction == "Incoming" or direction == "Both" then
            local incoming = ProcessLogs(Cobalt.shared.Logs.Incoming, "Incoming")
            for _, r in incoming do
                table.insert(allResults, r)
            end
        end

        -- Sort by total calls descending (most active remotes first)
        table.sort(allResults, function(a, b)
            return a.TotalCalls > b.TotalCalls
        end)

        -- Trim to limit
        if #allResults > limit then
            local trimmed = {}
            for i = 1, limit do
                trimmed[i] = allResults[i]
            end
            allResults = trimmed
        end

        return {
            count = #allResults,
            results = allResults
        }
    end)

    Bridge:BindToType("clear-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.ClearLogs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        Cobalt.shared.ClearLogs()

        return {
            status = "cleared",
            message = "All remote spy logs have been cleared."
        }
    end)

    Bridge:BindToType("block-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local direction = data.direction
        local shouldBlock = data.shouldBlock

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            if name == remoteName then
                if shouldBlock and not log.Blocked then
                    log:Block()
                elseif not shouldBlock and log.Blocked then
                    log:Block() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldBlock and "Blocked" or "Unblocked") .. " remote: " .. remoteName,
                    blocked = log.Blocked
                }
            end
        end

        error("Remote not found: " .. remoteName .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    Bridge:BindToType("ignore-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local direction = data.direction
        local shouldIgnore = data.shouldIgnore

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            if name == remoteName then
                if shouldIgnore and not log.Ignored then
                    log:Ignore()
                elseif not shouldIgnore and log.Ignored then
                    log:Ignore() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldIgnore and "Ignoring" or "Unignored") .. " remote: " .. remoteName,
                    ignored = log.Ignored
                }
            end
        end

        error("Remote not found: " .. remoteName .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    Bridge:BindToTypeRaw("script-grep", function(data)
        --// If mapping was deferred, start it now and wait for it to finish \\--
        if not HasStartedMapping then
            StartScriptMapping()
        end

        assert(ScriptSourcesMap.HasFinishedMapping, "The bridge is still mapping all script sources (" .. tostring(MappedSources) .. "/" .. tostring(SourcesToMap) .. ") please try again later.")

        local query = data.query
        local limit = data.limit or 50
        local contextLines = data.contextLines or 2
        local maxMatchesPerScript = data.maxMatchesPerScript or 20
        local maxResults = data.maxResults
        local isLiteral = data.literal == true
        local caseSensitive = data.caseSensitive ~= false

        --// Compile regex pattern \\--
        local re, compileErr = RegexEngine.compile(query, isLiteral, caseSensitive)
        if re == nil then
            return "Invalid regex pattern: " .. tostring(compileErr)
        end

        --// Search scripts \\--
        local results = {}
        local totalMatches = 0
        local count = 0

        for debugId, source in ScriptSourcesMap do
            if debugId == "HasFinishedMapping" then continue end
            if #results >= limit then break end
            if maxResults and totalMatches >= maxResults then break end

            --// Rate limit \\--
            count += 1
            if count % 200 == 0 then task.wait() end

            --// Split source into lines \\--
            local lines = {}
            local pos = 1
            while pos <= #source do
                local nl = source:find("\n", pos, true)
                if nl then
                    table.insert(lines, source:sub(pos, nl - 1))
                    pos = nl + 1
                else
                    table.insert(lines, source:sub(pos))
                    break
                end
            end

            --// Match per-line \\--
            local effectiveCap = maxMatchesPerScript
            if maxResults then
                effectiveCap = math.min(effectiveCap, maxResults - totalMatches)
            end

            local matchBlocks = {}
            for lineNum, line in lines do
                if #matchBlocks >= effectiveCap then break end

                if not RegexEngine.matchLine(re, line) then continue end

                local block = {}
                for i = math.max(1, lineNum - contextLines), lineNum - 1 do
                    table.insert(block, string.format("  %d: %s", i, lines[i] or ""))
                end
                table.insert(block, string.format("> %d: %s", lineNum, lines[lineNum] or ""))
                for i = lineNum + 1, math.min(#lines, lineNum + contextLines) do
                    table.insert(block, string.format("  %d: %s", i, lines[i] or ""))
                end

                table.insert(matchBlocks, table.concat(block, "\n"))
            end

            if #matchBlocks == 0 then continue end

            local scriptRef = GetScriptByDebugId(debugId)
            local scriptPath = scriptRef and scriptRef:GetFullName() or "<ScriptProxy: " .. debugId .. ">"

            totalMatches += #matchBlocks
            local scriptBlock = "[" .. scriptPath .. "] " .. #matchBlocks .. (#matchBlocks == 1 and " match" or " matches") .. "\n\n" .. table.concat(matchBlocks, "\n\n")
            table.insert(results, scriptBlock)
        end

        local header = totalMatches .. " total " .. (totalMatches == 1 and "match" or "matches") .. " across " .. #results .. (#results == 1 and " script" or " scripts")
        if #results >= limit or (maxResults and totalMatches >= maxResults) then
            header = header .. " (results limited)"
        end

        return header .. "\n\n" .. table.concat(results, "\n\n---\n\n")
    end)
    Bridge:CreateAlias("script-grep", {"search-scripts-sources"})

    Bridge:BindToType("type-text-box", function(data)
        local path = data.path
        local text = data.string or data.text
        local enter = data.enter
        local useKeyPress = data.useKeyPress

        local textBox
        if typeof(path) == "string" then
            textBox = loadstring("return " .. path)()
        else
            textBox = path
        end
        
        assert(typeof(textBox) == "Instance", "Path did not resolve to a valid Instance.")
        assert(textBox:IsA("TextBox"), "Resolved Instance is not a TextBox.")

        textBox:CaptureFocus()
        task.wait(0.05)
        
        if useKeyPress then
            local success = pcall(function()
                for i = 1, #text do
                    VirtualInputManager:SendTextInput(text:sub(i, i), nil, game)
                    task.wait(0.01)
                end
            end)
            
            if not success and type(keypress) == "function" then
                for i = 1, #text do
                    local char = text:sub(i, i):upper()
                    local byte = char:byte()
                    if byte then
                        keypress(byte)
                        task.wait(0.01)
                        if type(keyrelease) == "function" then
                            keyrelease(byte)
                        end
                    end
                end
            end
        else
            textBox.Text = text
        end

        if enter then
            if useKeyPress then
                if type(keypress) == "function" then
                    keypress(0x0D)
                    task.wait(0.01)
                    if type(keyrelease) == "function" then
                        keyrelease(0x0D)
                    end
                else
                    pcall(function()
                        VirtualInputManager:SendKeyEvent(true, Enum.KeyCode.Return, false, game)
                        task.wait(0.01)
                        VirtualInputManager:SendKeyEvent(false, Enum.KeyCode.Return, false, game)
                    end)
                end
            end
            textBox:ReleaseFocus(true)
        else
            textBox:ReleaseFocus(false)
        end

        return {
            status = "success",
            message = "Successfully typed into TextBox."
        }
    end)

    Bridge:BindToType("click-button", function(data)
        local path = data.path
        local action = data.Action or data.action

        local button
        if typeof(path) == "string" then
            button = loadstring("return " .. path)()
        else
            button = path
        end

        assert(typeof(button) == "Instance", "Path did not resolve to a valid Instance.")
        assert(button:IsA("GuiButton"), "Resolved Instance is not a GuiButton (e.g., TextButton or ImageButton).")
        assert(typeof(firesignal) == "function", "Your executor does not support 'firesignal', which is required for this command.")

        local Signals = {"Activated", "MouseButton1Down", "MouseButton2Down", "MouseButton1Click", "MouseButton2Click"}
        
        if action then
            assert(table.find(Signals, action), "Invalid action provided. Valid actions are: " .. table.concat(Signals, ", "))
            firesignal(button[action])
        else
            for _, signalName in pairs(Signals) do
                pcall(function() firesignal(button[signalName]) end)
            end
        end

        return {
            status = "success",
            message = "Successfully fired click signals on Button."
        }
    end)

    Bridge:WaitForDisconnect()
    
    task.wait(1)
end

