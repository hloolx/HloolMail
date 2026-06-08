package httpapi

import (
	"html"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gptmail/internal/models"
)

type verificationCodeCandidate struct {
	value       string
	score       int
	priority    int
	sourceOrder int
	index       int
}

type verificationCodeSource struct {
	text   string
	weight int
}

var (
	codeTokenPattern           = regexp.MustCompile(`(^|[^A-Za-z0-9])([A-Za-z0-9]{4,12})(?:$|[^A-Za-z0-9])`)
	separatedDigitsCodePattern = regexp.MustCompile(`(^|[^A-Za-z0-9])((?:\d[\s-]*){4,12})(?:$|[^A-Za-z0-9])`)
	longSeparatedNumberPattern = regexp.MustCompile(`\d{9,}`)
	codeSpacePattern           = regexp.MustCompile(`\s+`)
	codeLongNumberStripPattern = regexp.MustCompile(`[\s().+-]`)
)

var strongVerificationCodeKeywords = []string{
	"验证码",
	"驗證碼",
	"校验码",
	"校驗碼",
	"动态码",
	"動態碼",
	"短信码",
	"安全码",
	"认证码",
	"認證碼",
	"登录码",
	"登入碼",
	"确认码",
	"確認碼",
	"認証コード",
	"認證碼",
	"인증 코드",
	"verification code",
	"security code",
	"login code",
	"auth code",
	"authentication code",
	"confirmation code",
	"confirm code",
	"one-time password",
	"one time password",
	"passcode",
	"otp",
	"2fa",
	"mfa",
}

var weakVerificationCodeKeywords = []string{
	"verification",
	"verify",
	"verified",
	"one-time",
	"one time",
	"code",
	"pin",
	"captcha",
	"校验",
	"验证",
	"驗證",
	"認証",
	"認證",
	"인증",
}

var falsePositiveCodeKeywords = []string{
	"订单",
	"訂單",
	"订单号",
	"訂單號",
	"单号",
	"單號",
	"运单",
	"運單",
	"快递",
	"物流",
	"发票",
	"發票",
	"手机号",
	"手機號",
	"电话",
	"電話",
	"金额",
	"金額",
	"价格",
	"價格",
	"合计",
	"總計",
	"order",
	"invoice",
	"receipt",
	"tracking",
	"shipment",
	"delivery",
	"phone",
	"mobile",
	"tel",
	"amount",
	"total",
	"price",
	"postal",
	"zip",
	"address",
	"card",
	"issue",
	"pull request",
	"ticket",
	"build",
	"commit",
}

func extractVerificationCode(msg models.Message) string {
	candidates := extractVerificationCodeCandidates([]verificationCodeSource{
		{text: msg.Subject, weight: 22},
		{text: msg.TextContent, weight: 8},
		{text: stripTags(msg.HTMLContent), weight: 6},
	})
	if len(candidates) == 0 {
		return ""
	}
	return candidates[0].value
}

func extractVerificationCodeCandidates(sources []verificationCodeSource) []verificationCodeCandidate {
	byValue := make(map[string]verificationCodeCandidate)
	for sourceOrder, source := range sources {
		text := normalizeVerificationCodeText(source.text)
		if text == "" {
			continue
		}
		for _, candidate := range verificationCodeCandidatesFromText(text, source.weight, sourceOrder) {
			existing, ok := byValue[candidate.value]
			if !ok || compareVerificationCodeCandidates(candidate, existing) < 0 {
				byValue[candidate.value] = candidate
			}
		}
	}

	candidates := make([]verificationCodeCandidate, 0, len(byValue))
	for _, candidate := range byValue {
		candidates = append(candidates, candidate)
	}
	sort.Slice(candidates, func(i, j int) bool {
		return compareVerificationCodeCandidates(candidates[i], candidates[j]) < 0
	})
	return candidates
}

func verificationCodeCandidatesFromText(text string, sourceWeight int, sourceOrder int) []verificationCodeCandidate {
	var candidates []verificationCodeCandidate
	seen := make(map[string]struct{})

	for _, match := range codeTokenPattern.FindAllStringSubmatchIndex(text, -1) {
		value := text[match[4]:match[5]]
		index := match[2]
		if index < 0 {
			index = 0
		}
		pushVerificationCodeCandidate(&candidates, seen, text, value, index+len(text[match[2]:match[3]]), sourceWeight, sourceOrder)
	}

	for _, match := range separatedDigitsCodePattern.FindAllStringSubmatchIndex(text, -1) {
		raw := strings.TrimSpace(text[match[4]:match[5]])
		value := stripNonDigits(raw)
		if len(value) >= 4 && len(value) <= 12 && raw != value {
			index := match[2]
			if index < 0 {
				index = 0
			}
			pushVerificationCodeCandidate(&candidates, seen, text, value, index+len(text[match[2]:match[3]]), sourceWeight-1, sourceOrder)
		}
	}

	return candidates
}

func pushVerificationCodeCandidate(candidates *[]verificationCodeCandidate, seen map[string]struct{}, text string, value string, index int, sourceWeight int, sourceOrder int) {
	value = normalizeVerificationCodeValue(value)
	seenKey := value + ":" + strconv.Itoa(index)
	if _, ok := seen[seenKey]; ok {
		return
	}
	if !isVerificationCodeShape(value) || isLikelyFalsePositiveVerificationCode(text, value, index) {
		return
	}

	numeric := isAllDigits(value)
	keywordScore := verificationCodeKeywordBoost(text, value, index)
	lengthScore := alphaNumericVerificationCodeLengthScore(value)
	priority := 0
	baseScore := 72
	if numeric {
		lengthScore = numericVerificationCodeLengthScore(value)
		priority = 1
		baseScore = 120
	}
	*candidates = append(*candidates, verificationCodeCandidate{
		value:       value,
		score:       baseScore + sourceWeight + lengthScore + keywordScore,
		priority:    priority,
		sourceOrder: sourceOrder,
		index:       index,
	})
	seen[seenKey] = struct{}{}
}

func isVerificationCodeShape(value string) bool {
	if value == "" || !isASCIIAlphaNumeric(value) || !strings.ContainsAny(value, "0123456789") {
		return false
	}
	if isAllDigits(value) {
		return len(value) >= 4 && len(value) <= 8
	}
	return len(value) >= 4 && len(value) <= 12
}

func isLikelyFalsePositiveVerificationCode(text string, value string, index int) bool {
	numeric := isAllDigits(value)
	positiveDistance := nearestVerificationCodeKeywordDistance(text, index, len(value), append(strongVerificationCodeKeywords, weakVerificationCodeKeywords...))
	falsePositiveDistance := nearestVerificationCodeKeywordDistance(text, index, len(value), falsePositiveCodeKeywords)
	if numeric && isVerificationCodeYear(value) {
		return true
	}
	if numeric && isVerificationCodeYYYYMMDD(value) {
		return true
	}
	if numeric && isPartOfLongSeparatedVerificationNumber(text, index, len(value)) {
		return true
	}
	if falsePositiveDistance >= 0 && falsePositiveDistance <= 32 && (positiveDistance < 0 || positiveDistance > falsePositiveDistance) {
		return true
	}
	return false
}

func verificationCodeKeywordBoost(text string, value string, index int) int {
	strongDistance := nearestVerificationCodeKeywordDistance(text, index, len(value), strongVerificationCodeKeywords)
	weakDistance := nearestVerificationCodeKeywordDistance(text, index, len(value), weakVerificationCodeKeywords)
	return verificationCodeProximityScore(strongDistance, 92) + verificationCodeProximityScore(weakDistance, 52)
}

func verificationCodeProximityScore(distance int, strength int) int {
	if distance < 0 {
		return 0
	}
	if distance <= 12 {
		return strength
	}
	if distance <= 36 {
		return int(float64(strength) * 0.72)
	}
	if distance <= 80 {
		return int(float64(strength) * 0.38)
	}
	return 0
}

func nearestVerificationCodeKeywordDistance(text string, index int, length int, keywords []string) int {
	lower := strings.ToLower(text)
	nearest := -1
	for _, keyword := range keywords {
		needle := strings.ToLower(keyword)
		from := 0
		for from < len(lower) {
			found := strings.Index(lower[from:], needle)
			if found == -1 {
				break
			}
			found += from
			keywordEnd := found + len(needle)
			distance := 0
			if index > keywordEnd {
				distance = index - keywordEnd
			} else if found > index+length {
				distance = found - (index + length)
			}
			if nearest == -1 || distance < nearest {
				nearest = distance
			}
			from = found + max(1, len(needle))
		}
	}
	return nearest
}

func numericVerificationCodeLengthScore(value string) int {
	switch len(value) {
	case 6:
		return 26
	case 4, 5:
		return 16
	default:
		return 10
	}
}

func alphaNumericVerificationCodeLengthScore(value string) int {
	if len(value) >= 6 && len(value) <= 8 {
		return 12
	}
	return 6
}

func compareVerificationCodeCandidates(left verificationCodeCandidate, right verificationCodeCandidate) int {
	if left.priority != right.priority {
		return right.priority - left.priority
	}
	if left.score != right.score {
		return right.score - left.score
	}
	if left.sourceOrder != right.sourceOrder {
		return left.sourceOrder - right.sourceOrder
	}
	return left.index - right.index
}

func isVerificationCodeYear(value string) bool {
	if len(value) != 4 || !isAllDigits(value) {
		return false
	}
	year, err := strconv.Atoi(value)
	return err == nil && year >= 1900 && year <= 2099
}

func isVerificationCodeYYYYMMDD(value string) bool {
	if len(value) != 8 || !isAllDigits(value) || !strings.HasPrefix(value, "19") && !strings.HasPrefix(value, "20") {
		return false
	}
	year, _ := strconv.Atoi(value[:4])
	month, _ := strconv.Atoi(value[4:6])
	day, _ := strconv.Atoi(value[6:8])
	return year >= 1900 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

func isPartOfLongSeparatedVerificationNumber(text string, index int, length int) bool {
	start := max(0, index-16)
	end := min(len(text), index+length+16)
	compact := codeLongNumberStripPattern.ReplaceAllString(text[start:end], "")
	return longSeparatedNumberPattern.MatchString(compact)
}

func normalizeVerificationCodeText(value string) string {
	return codeSpacePattern.ReplaceAllString(html.UnescapeString(value), " ")
}

func normalizeVerificationCodeValue(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(value, "-", ""))
}

func stripNonDigits(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func isASCIIAlphaNumeric(value string) bool {
	for _, r := range value {
		if r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' {
			continue
		}
		return false
	}
	return true
}

func isAllDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
