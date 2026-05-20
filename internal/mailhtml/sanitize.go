package mailhtml

import (
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

var (
	mailPolicy = newMailPolicy()

	cssColorValue   = regexp.MustCompile(`(?i)^(?:#[0-9a-f]{3,8}|rgba?\(\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}(?:\s*,\s*(?:0|1|0?\.[0-9]+))?\s*\)|hsla?\(\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}%\s*,\s*[0-9]{1,3}%(?:\s*,\s*(?:0|1|0?\.[0-9]+))?\s*\)|transparent|currentcolor|inherit|initial|unset|black|white|red|blue|green|gray|grey|silver|navy|teal|yellow|orange|purple|maroon|fuchsia|lime|olive|aqua)$`)
	cssLengthValue  = regexp.MustCompile(`(?i)^(?:auto|0|-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:px|pt|pc|em|rem|ex|ch|%|in|cm|mm|vh|vw|vmin|vmax)?)$`)
	cssSpacingValue = regexp.MustCompile(`(?i)^(?:auto|0|-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:px|pt|pc|em|rem|ex|ch|%|in|cm|mm|vh|vw|vmin|vmax)?)(?:\s+(?:auto|0|-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:px|pt|pc|em|rem|ex|ch|%|in|cm|mm|vh|vw|vmin|vmax)?)){0,3}$`)
	cssNumberValue  = regexp.MustCompile(`^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$`)
	cssFamilyValue  = regexp.MustCompile(`(?i)^[a-z0-9\s,'"_\-.]+$`)
	cssBorderValue  = regexp.MustCompile(`(?i)^[#a-z0-9(),.%\s-]+$`)
)

// Sanitize returns HTML suitable for displaying an email body in a sandboxed iframe.
func Sanitize(html string) string {
	if strings.TrimSpace(html) == "" {
		return ""
	}
	return mailPolicy.Sanitize(html)
}

func newMailPolicy() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()

	p.AllowElements("center", "font")
	p.AllowAttrs("align").Matching(bluemonday.CellAlign).OnElements("table", "div", "p")
	p.AllowAttrs("bgcolor").Matching(cssColorValue).OnElements("table", "thead", "tbody", "tfoot", "tr", "td", "th", "font")
	p.AllowAttrs("color").Matching(cssColorValue).OnElements("font")
	p.AllowAttrs("border", "cellpadding", "cellspacing").Matching(bluemonday.Integer).OnElements("table")
	p.AllowAttrs("role").Matching(bluemonday.SpaceSeparatedTokens).OnElements("table")

	styleElements := []string{
		"a", "article", "blockquote", "center", "div", "figcaption", "figure", "font",
		"footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "img", "li", "main",
		"ol", "p", "section", "span", "strong", "table", "tbody", "td", "tfoot", "th",
		"thead", "tr", "ul",
	}
	p.AllowAttrs("style").OnElements(styleElements...)

	p.AllowStyles("color", "background-color", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color").
		MatchingHandler(matchStyle(cssColorValue, 80)).
		OnElements(styleElements...)
	p.AllowStyles("width", "height", "min-width", "max-width", "min-height", "max-height", "border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "letter-spacing").
		MatchingHandler(matchStyle(cssLengthValue, 40)).
		OnElements(styleElements...)
	p.AllowStyles("margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-spacing").
		MatchingHandler(matchStyle(cssSpacingValue, 80)).
		OnElements(styleElements...)
	p.AllowStyles("font-size").
		MatchingHandler(matchEnumOrPattern(cssLengthValue, 40, "xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "smaller", "larger")).
		OnElements(styleElements...)
	p.AllowStyles("font-family").
		MatchingHandler(matchStyle(cssFamilyValue, 120)).
		OnElements(styleElements...)
	p.AllowStyles("font-weight").
		MatchingHandler(matchEnumOrPattern(cssNumberValue, 20, "normal", "bold", "bolder", "lighter")).
		OnElements(styleElements...)
	p.AllowStyles("font-style").
		MatchingHandler(matchEnum(20, "normal", "italic", "oblique")).
		OnElements(styleElements...)
	p.AllowStyles("line-height").
		MatchingHandler(matchEnumOrPattern(cssLengthValue, 40, "normal")).
		OnElements(styleElements...)
	p.AllowStyles("text-align").
		MatchingHandler(matchEnum(20, "left", "right", "center", "justify", "start", "end")).
		OnElements(styleElements...)
	p.AllowStyles("vertical-align").
		MatchingHandler(matchEnumOrPattern(cssLengthValue, 40, "baseline", "bottom", "middle", "sub", "super", "text-bottom", "text-top", "top")).
		OnElements(styleElements...)
	p.AllowStyles("text-decoration").
		MatchingHandler(matchEnum(40, "none", "underline", "line-through", "overline")).
		OnElements(styleElements...)
	p.AllowStyles("border-collapse").
		MatchingHandler(matchEnum(20, "collapse", "separate")).
		OnElements(styleElements...)
	p.AllowStyles("border-style", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style").
		MatchingHandler(matchEnum(20, "none", "hidden", "solid", "dotted", "dashed", "double")).
		OnElements(styleElements...)
	p.AllowStyles("border", "border-top", "border-right", "border-bottom", "border-left").
		MatchingHandler(matchStyle(cssBorderValue, 120)).
		OnElements(styleElements...)
	p.AllowStyles("display").
		MatchingHandler(matchEnum(30, "block", "inline", "inline-block", "table", "table-row", "table-cell")).
		OnElements(styleElements...)
	p.AllowStyles("float").
		MatchingHandler(matchEnum(20, "left", "right", "none")).
		OnElements(styleElements...)
	p.AllowStyles("clear").
		MatchingHandler(matchEnum(20, "left", "right", "both", "none")).
		OnElements(styleElements...)
	p.AllowStyles("white-space").
		MatchingHandler(matchEnum(30, "normal", "nowrap", "pre", "pre-line", "pre-wrap")).
		OnElements(styleElements...)
	p.AllowStyles("word-break").
		MatchingHandler(matchEnum(30, "normal", "break-all", "break-word", "keep-all")).
		OnElements(styleElements...)

	return p
}

func matchStyle(pattern *regexp.Regexp, maxLen int) func(string) bool {
	return func(value string) bool {
		clean, ok := cleanStyleValue(value, maxLen)
		return ok && pattern.MatchString(clean)
	}
}

func matchEnum(maxLen int, allowed ...string) func(string) bool {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, value := range allowed {
		allowedSet[value] = struct{}{}
	}
	return func(value string) bool {
		clean, ok := cleanStyleValue(value, maxLen)
		if !ok {
			return false
		}
		_, ok = allowedSet[clean]
		return ok
	}
}

func matchEnumOrPattern(pattern *regexp.Regexp, maxLen int, allowed ...string) func(string) bool {
	enum := matchEnum(maxLen, allowed...)
	return func(value string) bool {
		if enum(value) {
			return true
		}
		clean, ok := cleanStyleValue(value, maxLen)
		return ok && pattern.MatchString(clean)
	}
}

func cleanStyleValue(value string, maxLen int) (string, bool) {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.TrimSpace(strings.TrimSuffix(value, "!important"))
	if value == "" || len(value) > maxLen {
		return "", false
	}
	for _, blocked := range []string{"url(", "expression", "javascript:", "vbscript:", "data:", "@import", "<", ">", "{", "}"} {
		if strings.Contains(value, blocked) {
			return "", false
		}
	}
	return value, true
}
