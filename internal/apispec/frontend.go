package apispec

func FrontendProjection() []FrontendOperation {
	ops := Operations()
	out := make([]FrontendOperation, 0, len(ops))
	for _, op := range ops {
		if op.Frontend == nil {
			continue
		}
		requestPath := op.Frontend.RequestPath
		if requestPath == "" {
			requestPath = op.Path
		}
		out = append(out, FrontendOperation{
			Method:        op.Method,
			Path:          op.DisplayPath(),
			Auth:          op.Auth,
			RequestPath:   requestPath,
			QueryTemplate: op.Frontend.QueryTemplate,
			BodyTemplate:  op.Frontend.BodyTemplate,
			Dangerous:     op.Frontend.Dangerous,
			Title:         op.Frontend.Title,
			Description:   op.Frontend.Description,
		})
	}
	return out
}
