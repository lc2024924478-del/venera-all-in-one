/** @type {import('./_venera_.js')} */

// 漫蛙漫画 (MANWA) — manwayy.cc 为主域名, 其余为同站镜像, 自动切换
// 本版按主人定的漫蛙模版写全功能, 取代此前只写了搜索/详情/阅读的简版 v1.0.0 (同 key 覆盖升级)
// 站点接口 (均已实测):
//   搜索:   GET  /api/search?type=mh&keyword=&page=&pageSize=20   (另支持 author:关键词)
//   详情:   GET  /api/comic/{id}            (status: 0=已完结, 1=连载中)
//   章节:   GET  /api/comic/{id}/chapters
//   图片:   GET  /api/comic/image/{chapterId}?page=&page_size=100[&image_source=]
//   分类:   POST /api/cate[/{slug}]         (注意: 分类筛选 status 与详情相反: 0=连载中, 1=已完结)
//   排行:   GET  /api/rank
//   推荐:   GET  /api/comic/{id}/recommends
//   登录:   POST /api/user/login            (返回 token, 之后请求带 Authorization: Bearer)
//   收藏:   /api/user/favorite(s) 系列接口 (需登录)
// 图片说明: 部分章节的图片是 AES-256-CBC 加密的 (前 16 字节为 IV), 这是网站阅读器
// 本身的交付方式, 本源在 onImageLoad 里按网站相同算法解密; 明文图片原样返回。
// VIP 章节: 不做任何绕过, 登录自有 VIP 账号后按账号权限阅读。

class Manwayy extends ComicSource {
    name = "漫蛙漫画"

    key = "manwayy"

    version = "1.1.0"

    minAppVersion = "1.4.0"

    url = ""

    // 图片解密密钥 (网站前端同款, 已实测可解出 WebP/JPEG)
    static AES_KEY = "0B6666A0-BB59-1381-B746-a0E4C9AC"

    static UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

    // 已实测全部可用的 API 镜像域名 (用于自动切换)
    static MIRRORS = [
        "https://manwayy.cc",
        "https://mwmwff.cc",
        "https://manwauu.cc",
        "https://manwarr.cc",
        "https://www.manwamm.cc",
        "https://www.manwawz.cc",
    ]

    // 分类: slug -> 中文标签 (与网站 /cate 页面的 data-value 一致)
    static CATEGORIES = [
        ["", "全部"],
        ["hotblooded", "热血"],
        ["xuanhuan", "玄幻"],
        ["romance", "恋爱"],
        ["adventure", "冒险"],
        ["historical", "古风"],
        ["urban", "都市"],
        ["transmigration", "穿越"],
        ["fantasy", "奇幻"],
        ["comedy", "搞笑"],
        ["shounen", "少男"],
        ["action", "战斗"],
        ["rebirth", "重生"],
        ["counterattack", "逆袭"],
        ["hilarious", "爆笑"],
        ["youth", "少年"],
        ["harem", "后宫"],
        ["system", "系统"],
        ["bl", "BL"],
        ["manhwa", "韩漫"],
        ["fullversion", "完整版"],
        ["19plus", "19r"],
        ["taiwanver", "台版"],
    ]

    normalizeUrl(value) {
        let text = String(value || "").trim()
        if (!text) return ""
        text = text.replace(/\/+$/, "")
        if (!/^https?:\/\//i.test(text)) text = "https://" + text
        return text
    }

    // 用户配置的域名 (自定义 > 下拉选择 > 默认)
    configuredDomain() {
        let custom = this.normalizeUrl(this.loadSetting("customDomain"))
        if (custom) return custom
        let pickedDomain = this.normalizeUrl(this.loadData("picked_domain"))
        if (pickedDomain) return pickedDomain
        let picked = this.normalizeUrl(this.loadSetting("domain"))
        if (picked) return picked
        return Manwayy.MIRRORS[0]
    }

    get ua() {
        let u = this.loadSetting("ua")
        return (u && String(u).trim() !== "") ? String(u).trim() : Manwayy.UA
    }

    // 实际使用的域名: 优先上次自动切换命中的镜像
    get baseUrl() {
        let configured = this.configuredDomain()
        let override = this.normalizeUrl(this.loadData("api_domain"))
        let overrideFor = this.normalizeUrl(this.loadData("api_override_for"))
        if (override && overrideFor === configured) return override
        return configured
    }

    get imageBase() {
        let custom = this.normalizeUrl(this.loadSetting("customImage"))
        if (custom) return custom
        return this.normalizeUrl(this.loadSetting("imageSource"))
    }

    headersFor(base, isJson) {
        let headers = {
            "User-Agent": this.ua,
            "Referer": base + "/",
            "Accept": "application/json, text/plain, */*",
        }
        let token = this.loadData("auth_token")
        if (token) headers["Authorization"] = "Bearer " + token
        if (isJson) headers["Content-Type"] = "application/json"
        return headers
    }

    isApiMiss(res) {
        if (!res) return true
        if (res.status === 404 || res.status === 502 || res.status === 503 || res.status >= 520) return true
        let body = String(res.body || "")
        if (!body) return res.status !== 200
        return body.charAt(0) === "<" || body.indexOf("<html") >= 0
    }

    readApi(res, path) {
        if (res.status === 401) throw "Login expired"
        let data
        try {
            data = JSON.parse(res.body || "{}")
        } catch (e) {
            throw `请求失败 ${res.status} ${path}`
        }
        // 个别接口 (如 /recommends) 直接返回数组, 没有 code/msg 外壳, 原样返回
        if (Array.isArray(data)) return data
        let msg = String((data && (data.msg || data.message)) || "")
        if (data && (data.code === 401 || /请先登录|请登录|未登录|登录已过期|token失效|token过期|未授权/.test(msg))) {
            throw "Login expired"
        }
        if (res.status !== 200 || !data || data.code !== 200) {
            throw msg || `接口返回异常 ${path}`
        }
        return data.data !== undefined ? data.data : data
    }

    // 带镜像自动切换的请求: 配置域名打不开时依次尝试其他镜像, 命中的记下来
    async request(method, path, payload, contentType) {
        let bases = []
        let push = (v) => {
            let b = this.normalizeUrl(v)
            if (b && bases.indexOf(b) < 0) bases.push(b)
        }
        push(this.baseUrl)
        push(this.configuredDomain())
        Manwayy.MIRRORS.forEach(push)
        let last = null
        let lastErr = null
        for (let base of bases) {
            let headers = this.headersFor(base, contentType === "json")
            if (contentType === "form") headers["Content-Type"] = "application/x-www-form-urlencoded"
            let res
            try {
                if (method === "POST") res = await Network.post(base + path, headers, payload)
                else if (method === "DELETE") res = await Network.delete(base + path, headers)
                else res = await Network.get(base + path, headers)
            } catch (e) {
                lastErr = e
                continue
            }
            if (this.isApiMiss(res)) {
                last = res
                continue
            }
            let configured = this.configuredDomain()
            if (base === configured) {
                this.deleteData("api_domain")
                this.deleteData("api_override_for")
            } else {
                this.saveData("api_domain", base)
                this.saveData("api_override_for", configured)
            }
            return this.readApi(res, path)
        }
        if (last) return this.readApi(last, path)
        throw lastErr || "所有域名都打不开, 请在源设置里更换域名"
    }

    async getJson(path) {
        return this.request("GET", path, null, null)
    }

    async postJson(path, obj) {
        return this.request("POST", path, JSON.stringify(obj), "json")
    }

    async postForm(path, bodyString) {
        return this.request("POST", path, bodyString, "form")
    }

    init() {
        if (this.account) {
            this.account.registerWebsite = this.configuredDomain() + "/user/register"
        }
    }

    comicIdOf(urlOrId) {
        let text = String(urlOrId || "")
        let m = text.match(/\/comic\/(\d+)/)
        if (m) return m[1]
        let d = text.match(/(\d+)/)
        return d ? d[1] : text
    }

    splitTags(value) {
        if (!value) return []
        return String(value).split(/[,，|]/).map(t => t.trim()).filter(t => t !== "")
    }

    formatTime(unixSeconds) {
        let n = Number(unixSeconds)
        if (!n) return ""
        let dt = new Date(n * 1000)
        let p = (x) => String(x).padStart(2, "0")
        return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
    }

    // 把图片地址换到所选线路 (只换域名, 路径不变); 未选线路时原样返回
    rewriteImageUrl(url) {
        let raw = String(url || "").trim()
        if (!raw) return raw
        let base = this.imageBase
        if (!base) return raw
        let m = raw.match(/^https?:\/\/[^/]+(\/[^?#]*)?/i)
        if (!m) return base + (raw.charAt(0) === "/" ? raw : "/" + raw)
        return base + (m[1] || "/")
    }

    toComment(c) {
        let user = (c && c.user) || {}
        return new Comment({
            userName: user.nickname || user.username || "匿名",
            avatar: user.avatar || "",
            content: c.content || "",
            time: c.created_at || "",
            replyCount: Number(c.feed_count || (c.replies ? c.replies.length : 0) || 0),
            id: String(c.id),
        })
    }

    parseComic(item) {
        if (!item) return null
        let id = item.id
        if ((id === undefined || id === null) && item.url) {
            let m = String(item.url).match(/\/comic\/(\d+)/)
            if (m) id = m[1]
        }
        if (id === undefined || id === null || id === "") return null
        return new Comic({
            id: String(id),
            title: item.title || "",
            subTitle: item.author || "",
            cover: this.rewriteImageUrl(item.cover || item.pic || ""),
            tags: this.splitTags(item.tags).slice(0, 8),
            description: item.description || item.intro || "",
        })
    }

    parseComicList(list) {
        if (!Array.isArray(list)) return []
        let out = []
        for (let item of list) {
            let c = this.parseComic(item)
            if (c) out.push(c)
        }
        return out
    }

    // 分类接口: POST /api/cate[/{slug}]
    // filters: {sort, status, areaId, level, tag}
    // 注意 status 是分类筛选语义: -1=全部, 0=连载中, 1=已完结 (与详情字段相反, 已实测)
    async loadCate(slug, filters, page) {
        let pageSize = 36
        let path = slug ? `/api/cate/${encodeURIComponent(slug)}` : "/api/cate"
        let data = await this.postJson(path, {
            page: { page: page, pageSize: pageSize },
            category: "comic",
            sort: Number(filters.sort ?? 0),
            comic: {
                status: Number(filters.status ?? -1),
                day: 0,
                tag: filters.tag || "",
                level: Number(filters.level ?? 0),
                areaId: Number(filters.areaId ?? 0),
            },
        })
        let total = Number((data && data.total) || 0)
        return {
            comics: this.parseComicList(data && data.list),
            maxPage: Math.max(1, Math.ceil(total / pageSize)),
        }
    }

    async loadRank() {
        let data = await this.getJson("/api/rank")
        return this.parseComicList((data && data.list) || [])
    }

    // ---------- 图片解密 ----------
    isPlainImage(bytes) {
        if (!bytes || bytes.length < 4) return false
        return (
            (bytes[0] === 0xff && bytes[1] === 0xd8) || // JPEG
            (bytes[0] === 0x89 && bytes[1] === 0x50) || // PNG
            (bytes[0] === 0x47 && bytes[1] === 0x49) || // GIF
            (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) // RIFF/WebP
        )
    }

    // 解密后去掉尾部填充 (网站在真实文件尾后补了等值字节)
    trimDecoded(buffer) {
        let bytes = new Uint8Array(buffer)
        let n = bytes.length
        if (n > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            let size = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)
            let end = size + 8
            if (end > 12 && end <= n) return buffer.slice(0, end)
        }
        if (n > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
            let p = 8
            while (p + 8 <= n) {
                let len = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]
                let type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
                let next = p + 12 + len
                if (len < 0 || next > n) break
                if (type === "IEND") return buffer.slice(0, next)
                p = next
            }
        }
        if (n > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
            let pad = bytes[n - 1]
            if (pad >= 1 && pad <= 16 && n > pad + 2) {
                let ok = true
                for (let i = 0; i < pad; i++) {
                    if (bytes[n - 1 - i] !== pad) ok = false
                }
                if (ok && bytes[n - pad - 2] === 0xff && bytes[n - pad - 1] === 0xd9) {
                    return buffer.slice(0, n - pad)
                }
            }
        }
        return buffer
    }

    imageConfig(url) {
        return {
            url: url,
            headers: {
                "User-Agent": this.ua,
                "Referer": this.baseUrl + "/",
            },
            onResponse: (data) => {
                try {
                    let bytes = new Uint8Array(data)
                    if (this.isPlainImage(bytes)) return data
                    if (bytes.length <= 16) return data
                    let key = Convert.encodeUtf8(Manwayy.AES_KEY)
                    let plain = Convert.decryptAesCbc(data.slice(16), key, data.slice(0, 16))
                    return this.trimDecoded(plain)
                } catch (e) {
                    return data
                }
            },
        }
    }

    // ---------- 账号 ----------
    account = {
        login: async (account, pwd) => {
            let username = String(account || "").trim()
            let password = String(pwd || "")
            if (!username || !password) throw "请输入账号和密码"
            let data = await this.postJson("/api/user/login", {
                username: username,
                password: password,
            })
            if (!data || !data.token) throw "登录失败"
            this.saveData("auth_token", data.token)
            this.saveData("user_id", String(data.userId || ""))
            try {
                let host = (this.baseUrl.match(/^https?:\/\/([^/]+)/i) || [])[1] || ""
                if (host) {
                    Network.setCookies(this.baseUrl + "/", [
                        new Cookie({ name: "authToken", value: data.token, domain: host }),
                        new Cookie({ name: "userId", value: String(data.userId || ""), domain: host }),
                    ])
                }
            } catch (e) {}
            return String(data.userId || username)
        },
        logout: () => {
            this.deleteData("auth_token")
            this.deleteData("user_id")
            try {
                Network.deleteCookies(this.baseUrl + "/")
            } catch (e) {}
        },
        registerWebsite: "https://manwayy.cc/user/register",
    }

    // ---------- 收藏 (需登录) ----------
    favorites = {
        multiFolder: true,
        addOrDelFavorite: async (comicId, folderId, isAdding, favoriteId) => {
            if (!this.loadData("auth_token")) throw "Login expired"
            let id = this.comicIdOf(comicId)
            if (isAdding) {
                let categoryId = folderId === null || folderId === undefined || folderId === "" ? "0" : String(folderId)
                await this.postForm("/api/user/favorite/add",
                    `comic_id=${encodeURIComponent(id)}&category_id=${encodeURIComponent(categoryId)}`)
            } else {
                await this.postForm("/api/user/favorite/delete",
                    `comic_id=${encodeURIComponent(id)}`)
            }
            return "ok"
        },
        loadFolders: async (comicId) => {
            if (!this.loadData("auth_token")) throw "Login expired"
            let data = await this.getJson("/api/user/favorites/categories")
            let list = (data && (data.list || data.List)) || (Array.isArray(data) ? data : [])
            let folders = { "0": "未分类" }
            for (let cat of list) {
                let cid = cat.id !== undefined && cat.id !== null ? cat.id : cat.Id
                if (cid !== undefined && cid !== null) folders[String(cid)] = String(cat.name || cat.Name || "未命名")
            }
            let favorited = []
            if (comicId) {
                try {
                    let check = await this.getJson(`/api/user/favorite/check?comic_id=${encodeURIComponent(this.comicIdOf(comicId))}`)
                    if (check && typeof check === "object") {
                        let categoryId = check.category_id ?? check.categoryId ?? check.CategoryId
                        if (categoryId !== undefined && categoryId !== null && folders[String(categoryId)]) {
                            favorited.push(String(categoryId))
                        } else if (check.isFavorite || check.is_favorite || check.favorited) {
                            favorited.push("0")
                        }
                    } else if (check) {
                        favorited.push("0")
                    }
                } catch (e) {}
            }
            return { folders: folders, favorited: favorited }
        },
        addFolder: async (name) => {
            if (!this.loadData("auth_token")) throw "Login expired"
            await this.postJson("/api/user/favorites/categories", { name: name })
            return "ok"
        },
        deleteFolder: async (folderId) => {
            if (!this.loadData("auth_token")) throw "Login expired"
            await this.request("DELETE", `/api/user/favorites/categories/${encodeURIComponent(folderId)}`, null, null)
            return "ok"
        },
        loadComics: async (page, folder) => {
            if (!this.loadData("auth_token")) throw "Login expired"
            let pageSize = 20
            let path = `/api/user/favorites?page=${page}&page_size=${pageSize}`
            if (folder !== null && folder !== undefined && folder !== "" && folder !== "all") {
                path += `&categoryId=${encodeURIComponent(folder)}`
            }
            let data = await this.getJson(path)
            let list = (data && data.list) || []
            let maxPage = Math.max(1, Number((data && (data.total_page || data.totalPage)) || 1))
            let comics = []
            for (let item of list) {
                let c = this.parseComic({
                    id: item.comic_id || item.id,
                    title: item.title,
                    cover: item.cover,
                    author: item.author || "",
                    tags: item.tags || "",
                })
                if (c) comics.push(c)
            }
            return { comics: comics, maxPage: maxPage }
        },
    }

    explore = [
        {
            title: "漫蛙漫画",
            type: "multiPartPage",
            load: async (page) => {
                if (page !== null && page !== undefined && page !== 1) {
                    return []
                }
                let parts = []
                let jobs = [
                    { title: "最新更新", run: async () => (await this.loadCate("", { sort: 0 }, 1)).comics, target: "" },
                    { title: "新作上架", run: async () => (await this.loadCate("", { sort: 1 }, 1)).comics, target: "" },
                    { title: "热门排行", run: async () => await this.loadRank(), target: "manhwa" },
                ]
                for (let job of jobs) {
                    try {
                        let comics = await job.run()
                        if (comics.length > 0) {
                            parts.push({
                                title: job.title,
                                comics: comics,
                                viewMore: {
                                    page: "category",
                                    attributes: { category: job.target, param: job.target === "" ? "" : "韩漫" },
                                },
                            })
                        }
                    } catch (e) {}
                }
                if (parts.length === 0) throw "首页加载失败, 请检查网络后重试"
                return parts
            },
        },
    ]

    category = {
        title: "漫蛙漫画",
        parts: [
            {
                name: "分类",
                type: "fixed",
                categories: Manwayy.CATEGORIES.map(([slug, label]) => ({
                    label: label,
                    target: {
                        page: "category",
                        attributes: { category: slug, param: slug === "" ? "" : label },
                    },
                })),
            },
        ],
        enableRankingPage: true,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            // options: [排序, 进度, 地区, 分级]
            let opt = (i, dft) => (options && options[i] !== undefined && options[i] !== null && options[i] !== "" ? options[i] : dft)
            return await this.loadCate(category || "", {
                sort: opt(0, "0"),
                status: opt(1, "-1"),
                areaId: opt(2, "0"),
                level: opt(3, "0"),
                tag: param || "",
            }, page)
        },
        optionList: [
            {
                label: "排序",
                options: ["0-更新", "1-新作", "3-热门"],
            },
            {
                label: "进度",
                options: ["-1-全部", "0-连载中", "1-已完结"],
            },
            {
                label: "地区",
                options: ["0-全部", "2-韩国", "3-日漫", "4-国漫", "5-台漫", "6-其他"],
            },
            {
                label: "分级",
                options: ["0-全部", "2-VIP无码"],
            },
        ],
        ranking: {
            options: ["rank-排行"],
            load: async (option, page) => {
                if (page !== 1) return { comics: [], maxPage: 1 }
                return { comics: await this.loadRank(), maxPage: 1 }
            },
        },
    }

    search = {
        load: async (keyword, options, page) => {
            let text = String(keyword || "").trim()
            if (!text) return { comics: [], maxPage: 1 }
            let pageSize = 20
            let path
            if (text.indexOf("author:") === 0) {
                path = `/api/search?type=mh&page=${page}&pageSize=${pageSize}&author=${encodeURIComponent(text.slice(7).trim())}`
            } else {
                path = `/api/search?type=mh&page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(text)}`
            }
            let data = await this.getJson(path)
            let total = Number((data && data.total) || 0)
            return {
                comics: this.parseComicList(data && data.list),
                maxPage: Math.max(1, Math.ceil(total / pageSize)),
            }
        },
        optionList: [],
    }

    comic = {
        loadInfo: async (id) => {
            let comicId = this.comicIdOf(id)
            let d = await this.getJson(`/api/comic/${encodeURIComponent(comicId)}`)
            if (!d || !d.title) {
                throw "漫画不存在或已被下架"
            }

            let chapters = new Map()
            try {
                let chData = await this.getJson(`/api/comic/${encodeURIComponent(comicId)}/chapters`)
                let list = ((chData && chData.list) || []).slice()
                list.sort((a, b) => {
                    let s = Number(a.sortId || 0) - Number(b.sortId || 0)
                    return s !== 0 ? s : Number(a.id || 0) - Number(b.id || 0)
                })
                for (let ch of list) {
                    let title = ch.title || String(ch.id)
                    if (ch.isVip) title = `${title} [VIP]`
                    chapters.set(String(ch.id), title)
                }
            } catch (e) {
                if (e === "Login expired") throw e
            }

            let tags = {}
            if (d.author) tags["作者"] = [d.author]
            // 详情接口 status: 0 = 已完结, 1 = 连载中 (与详情页显示核对过)
            tags["状态"] = [d.status === 0 ? "已完结" : "连载中"]
            let tagList = this.splitTags(d.tags)
            if (tagList.length > 0) tags["标签"] = tagList

            let recommend = []
            try {
                let recData = await this.getJson(`/api/comic/${encodeURIComponent(comicId)}/recommends`)
                let recList = Array.isArray(recData) ? recData : ((recData && recData.list) || [])
                recommend = this.parseComicList(recList)
            } catch (e) {}

            return new ComicDetails({
                title: d.title,
                subTitle: d.author || "",
                cover: this.rewriteImageUrl(d.cover || ""),
                description: (d.intro || "").trim(),
                tags: tags,
                chapters: chapters,
                updateTime: this.formatTime(d.editTime),
                recommend: recommend,
                url: `${this.baseUrl}/comic/${comicId}`,
            })
        },

        loadEp: async (comicId, epId) => {
            let chapterId = String(epId || "").split("_")[0]
            let images = []
            let page = 1
            let totalPages = 1
            let pageSize = 100
            let sourceQuery = this.imageBase ? `&image_source=${encodeURIComponent(this.imageBase)}` : ""
            while (page <= totalPages && page <= 40) {
                let data = await this.getJson(`/api/comic/image/${encodeURIComponent(chapterId)}?page=${page}&page_size=${pageSize}${sourceQuery}`)
                let list = (data && data.images) || []
                if (list.length === 0) break
                for (let img of list) {
                    if (img && img.url) images.push(this.rewriteImageUrl(img.url))
                }
                let pagination = data && data.pagination
                totalPages = Math.max(1, Number((pagination && pagination.total_pages) || 1))
                page++
            }
            if (images.length === 0) {
                throw "本章节暂无图片 (可能是 VIP 章节, 登录有权限的账号后可阅读)"
            }
            return { images: images }
        },

        onImageLoad: (url, comicId, epId) => {
            return this.imageConfig(url)
        },

        onThumbnailLoad: (url) => {
            return this.imageConfig(url)
        },

        onClickTag: (namespace, tag) => {
            if (namespace === "作者") {
                return { action: "search", keyword: "author:" + tag }
            }
            return { action: "search", keyword: tag }
        },

        loadComments: async (comicId, subId, page, replyTo) => {
            let id = this.comicIdOf(comicId)
            let pageSize = 20
            if (replyTo) {
                // 子评论 (回复列表): 网站接口 /api/comments/page?commentId=
                try {
                    let data = await this.getJson(`/api/comments/page?commentId=${encodeURIComponent(replyTo)}&comic_id=${encodeURIComponent(id)}&page_size=${pageSize}`)
                    let list = (data && (data.list || data.comments)) || (Array.isArray(data) ? data : [])
                    return {
                        comments: list.map(c => this.toComment(c)),
                        maxPage: 1,
                    }
                } catch (e) {
                    return { comments: [], maxPage: 1 }
                }
            }
            let data = await this.getJson(`/api/comments?comic_id=${encodeURIComponent(id)}&page=${page}&page_size=${pageSize}`)
            let list = (data && data.list) || []
            let total = Number((data && data.total) || list.length)
            return {
                comments: list.map(c => this.toComment(c)),
                maxPage: Math.max(1, Math.ceil(total / pageSize)),
            }
        },

        sendComment: async (comicId, subId, content, replyTo) => {
            if (!this.loadData("auth_token")) throw "Login expired"
            let id = this.comicIdOf(comicId)
            await this.postJson("/api/comment", {
                comic_id: Number(id),
                chapter_id: 0,
                content: String(content || ""),
                parent_id: replyTo ? Number(replyTo) || 0 : 0,
                reply_to_id: replyTo ? String(replyTo) : "",
            })
            return "ok"
        },

        link: {
            domains: [
                "mwmwff.cc", "manwauu.cc", "manwarr.cc", "manwamm.cc",
                "www.manwamm.cc", "manwayy.cc", "manwawz.cc", "www.manwawz.cc",
                "mwmw.cc", "mwmw1.cc", "mwmw2.cc", "mwmw3.cc", "mwmw4.cc",
                "mwmw5.cc", "mwmw6.cc", "mwmw7.cc", "mwmw8.cc", "mwmw9.cc",
            ],
            linkToId: (url) => {
                let m = String(url).match(/\/comic\/(\d+)/)
                return m ? m[1] : null
            },
        },
    }

    settings = {
        domain: {
            title: "站点域名",
            type: "select",
            options: Manwayy.MIRRORS.map(u => ({ value: u, text: u.replace(/^https?:\/\//, "") })),
            default: "https://manwayy.cc",
        },
        pickDomain: {
            title: "从发布页切换域名 (su7.la)",
            type: "callback",
            buttonText: "打开域名列表",
            callback: async () => {
                let loadingId = UI.showLoading()
                let domains = Manwayy.MIRRORS.slice()
                try {
                    let res = await Network.get("https://www.su7.la/", { "User-Agent": this.ua })
                    if (res.status === 200 && res.body) {
                        let found = Manwayy.MIRRORS.slice()
                        let skip = /su7\.la|mwapp\.cc|aizhantj\.com/i
                        let re = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
                        let match
                        while ((match = re.exec(res.body))) {
                            let href = match[0].replace(/\/+$/, "")
                            if (skip.test(href) || found.indexOf(href) >= 0) continue
                            // 只收录实测带接口的域名形态, 入口页 (mwmw*.cc) 没有接口, 单独标注靠后
                            found.push(href)
                        }
                        domains = found
                    }
                } catch (e) {
                    UI.showMessage("发布页打不开, 先用内置域名")
                } finally {
                    UI.cancelLoading(loadingId)
                }
                let labels = ["跟随上面的下拉框"].concat(domains.map(d => d.replace(/^https?:\/\//, "")))
                let current = this.normalizeUrl(this.loadData("picked_domain"))
                let index = 0
                if (current) {
                    let at = domains.indexOf(current)
                    if (at >= 0) index = at + 1
                }
                let selected = await UI.showSelectDialog("选择漫蛙域名", labels, index)
                if (selected === null || selected === undefined) return
                if (selected === 0) {
                    this.deleteData("picked_domain")
                    this.deleteData("api_domain")
                    this.deleteData("api_override_for")
                    UI.showMessage("已改回使用下拉框的域名")
                    return
                }
                let chosen = domains[selected - 1]
                this.saveData("picked_domain", chosen)
                this.deleteData("api_domain")
                this.deleteData("api_override_for")
                if (this.normalizeUrl(this.loadSetting("customDomain"))) {
                    UI.showMessage(`已记住 ${chosen}, 但自定义域名不为空, 清空后才生效`)
                } else {
                    UI.showMessage(`已切换到 ${chosen}`)
                }
            },
        },
        customDomain: {
            title: "自定义域名 (填写后最优先, 留空忽略)",
            type: "input",
            validator: null,
            default: "",
        },
        imageSource: {
            title: "图片线路 (留空 = 用接口返回的地址)",
            type: "select",
            options: [
                { value: "", text: "默认 (接口返回)" },
                { value: "https://tu.mwzu.cc", text: "tu.mwzu.cc" },
                { value: "https://tu.mhttu.cc", text: "tu.mhttu.cc" },
                { value: "https://mwtusi.cc", text: "mwtusi.cc" },
                { value: "https://52.128.238.250:5367", text: "IP 线路 5367" },
                { value: "https://38.147.106.154:8088", text: "IP 线路 8088" },
                { value: "https://38.246.114.12:8067", text: "IP 线路 8067" },
            ],
            default: "",
        },
        customImage: {
            title: "自定义图片域名 (填写后优先于线路)",
            type: "input",
            validator: null,
            default: "",
        },
        ua: {
            title: "User-Agent (留空用内置)",
            type: "input",
            validator: null,
            default: "",
        },
    }

    translation = {
        "zh_CN": {
            "站点域名": "站点域名",
            "自定义域名 (填写后最优先, 留空忽略)": "自定义域名 (填写后最优先, 留空忽略)",
            "图片线路 (留空 = 用接口返回的地址)": "图片线路 (留空 = 用接口返回的地址)",
            "自定义图片域名 (填写后优先于线路)": "自定义图片域名 (填写后优先于线路)",
        },
        "zh_TW": {},
        "en": {},
    }
}
