package scheduler

import (
	"context"
	"log/slog"
	"time"
)

type TaskFunc func(context.Context)

type Task struct {
	Name       string
	Interval   time.Duration
	RunOnStart bool
	Fn         TaskFunc
}

type Runner struct {
	tasks []Task
}

func New() *Runner {
	return &Runner{}
}

func (r *Runner) Every(name string, interval time.Duration, runOnStart bool, fn TaskFunc) {
	if r == nil || interval <= 0 || fn == nil {
		return
	}
	r.tasks = append(r.tasks, Task{
		Name:       name,
		Interval:   interval,
		RunOnStart: runOnStart,
		Fn:         fn,
	})
}

func (r *Runner) Start(ctx context.Context) {
	if r == nil {
		return
	}
	for _, task := range r.tasks {
		task := task
		go runTaskLoop(ctx, task)
	}
}

func Every(ctx context.Context, name string, interval time.Duration, runOnStart bool, fn TaskFunc) {
	runTaskLoop(ctx, Task{Name: name, Interval: interval, RunOnStart: runOnStart, Fn: fn})
}

func DailyAt(ctx context.Context, name string, hour int, minute int, runOnStart bool, fn TaskFunc) {
	if fn == nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return
	}
	task := Task{Name: name, RunOnStart: runOnStart, Fn: fn}
	if task.RunOnStart {
		runOnce(ctx, task)
	}
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, now.Location())
		if !next.After(now) {
			next = next.Add(24 * time.Hour)
		}
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			runOnce(ctx, task)
		}
	}
}

func runTaskLoop(ctx context.Context, task Task) {
	if task.Interval <= 0 || task.Fn == nil {
		return
	}
	if task.RunOnStart {
		runOnce(ctx, task)
	}
	ticker := time.NewTicker(task.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOnce(ctx, task)
		}
	}
}

func runOnce(ctx context.Context, task Task) {
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("scheduled task panicked", "task", task.Name, "panic", recovered)
		}
	}()
	task.Fn(ctx)
}
