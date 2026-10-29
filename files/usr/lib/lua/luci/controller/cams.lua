module("luci.controller.cams", package.seeall)

function index()
	entry({"admin", "services", "cams"}, view("cams/settings"), _("Вебкамери"), 60)
end
