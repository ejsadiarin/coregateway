package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/config"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	monitor "github.com/ejsadiarin/coregateway/internal/monitor"
	"github.com/ejsadiarin/coregateway/internal/user"
)

// nativeStubQuerier implements sqlc.Querier with an embedded nil interface:
// only the methods these tests exercise are overridden.
type nativeStubQuerier struct {
	db.Querier
	users   map[uuid.UUID]db.CoregatewayUser
	created []db.CreateUserParams
	deleted []uuid.UUID
}

func (q *nativeStubQuerier) ListUsers(context.Context) ([]db.CoregatewayUser, error) {
	out := make([]db.CoregatewayUser, 0, len(q.users))
	for _, u := range q.users {
		out = append(out, u)
	}
	return out, nil
}

func (q *nativeStubQuerier) GetUserByEmail(_ context.Context, _ string) (db.CoregatewayUser, error) {
	return db.CoregatewayUser{}, pgx.ErrNoRows
}

func (q *nativeStubQuerier) CreateUser(_ context.Context, arg db.CreateUserParams) (db.CoregatewayUser, error) {
	q.created = append(q.created, arg)
	u := db.CoregatewayUser{ID: uuid.New(), Email: arg.Email, Role: arg.Role}
	q.users[u.ID] = u
	return u, nil
}

func (q *nativeStubQuerier) GetUser(_ context.Context, id uuid.UUID) (db.CoregatewayUser, error) {
	if u, ok := q.users[id]; ok {
		return u, nil
	}
	return db.CoregatewayUser{}, pgx.ErrNoRows
}

func (q *nativeStubQuerier) UpdateUser(_ context.Context, arg db.UpdateUserParams) (db.CoregatewayUser, error) {
	u := q.users[arg.ID]
	if arg.Email.Valid {
		u.Email = arg.Email.String
	}
	if arg.Role.Valid {
		u.Role = arg.Role.String
	}
	q.users[arg.ID] = u
	return u, nil
}

func (q *nativeStubQuerier) DeleteUserSessions(context.Context, uuid.UUID) error { return nil }

func (q *nativeStubQuerier) DeleteUser(_ context.Context, id uuid.UUID) error {
	q.deleted = append(q.deleted, id)
	delete(q.users, id)
	return nil
}

func (q *nativeStubQuerier) CreateService(_ context.Context, arg db.CreateServiceParams) (db.CoregatewayService, error) {
	return db.CoregatewayService{ID: uuid.New(), Name: arg.Name}, nil
}

func (q *nativeStubQuerier) ListServices(context.Context) ([]db.ListServicesRow, error) {
	return []db.ListServicesRow{}, nil
}

func (q *nativeStubQuerier) GetService(_ context.Context, id uuid.UUID) (db.CoregatewayService, error) {
	return db.CoregatewayService{ID: id, Name: "svc"}, nil
}

func (q *nativeStubQuerier) UpdateService(_ context.Context, arg db.UpdateServiceParams) (db.CoregatewayService, error) {
	return db.CoregatewayService{ID: arg.ID, Name: "svc"}, nil
}

func (q *nativeStubQuerier) DeleteService(context.Context, uuid.UUID) error { return nil }

func (q *nativeStubQuerier) GetServiceHistory(context.Context, db.GetServiceHistoryParams) ([]db.CoregatewayServiceHealthHistory, error) {
	return []db.CoregatewayServiceHealthHistory{}, nil
}

func (q *nativeStubQuerier) GetServiceStats24h(context.Context, pgtype.UUID) (db.GetServiceStats24hRow, error) {
	return db.GetServiceStats24hRow{}, nil
}

func (q *nativeStubQuerier) GetServiceStats7d(context.Context, pgtype.UUID) (db.GetServiceStats7dRow, error) {
	return db.GetServiceStats7dRow{}, nil
}

func (q *nativeStubQuerier) GetServiceStats30d(context.Context, pgtype.UUID) (db.GetServiceStats30dRow, error) {
	return db.GetServiceStats30dRow{}, nil
}

func (q *nativeStubQuerier) GetAllServicesStats(context.Context) (db.GetAllServicesStatsRow, error) {
	return db.GetAllServicesStatsRow{}, nil
}

func nativeTestSetup(t *testing.T) (http.Handler, *nativeStubQuerier, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	adminID := uuid.New()
	userID := uuid.New()
	victimID := uuid.New()
	q := &nativeStubQuerier{users: map[uuid.UUID]db.CoregatewayUser{
		adminID:  {ID: adminID, Email: "admin@example.com", Role: auth.RoleAdmin},
		userID:   {ID: userID, Email: "user@example.com", Role: auth.RoleUser},
		victimID: {ID: victimID, Email: "victim@example.com", Role: auth.RoleUser},
	}}
	s := &Server{
		UserHandler:    user.NewHandler(user.NewService(q)),
		ServiceHandler: monitor.NewHandler(monitor.NewService(q)),
	}
	// Real route table (nil CorefinanceClient is fine: these tests never
	// touch /api/budget/*). AuthMiddleware passes identity-less requests
	// through, so injected identities behave like validated sessions.
	return s.RegisterRoutes(&config.Config{}), q, adminID, userID, victimID
}

// doNative sends a request with the given role identity injected.
func doNative(t *testing.T, h http.Handler, role string, id uuid.UUID, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	}
	if role != "" {
		req = req.WithContext(auth.ContextWithUser(req.Context(), &auth.UserContext{
			ID:    id,
			Email: role + "@example.com",
			Role:  role,
		}))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestNativeUserRoutesMatrix(t *testing.T) {
	newRouter := func(t *testing.T) (http.Handler, *nativeStubQuerier, uuid.UUID, uuid.UUID, uuid.UUID) {
		return nativeTestSetup(t)
	}

	t.Run("anonymous create admin rejected, creates nothing", func(t *testing.T) {
		h, q, _, _, _ := newRouter(t)
		rec := doNative(t, h, "", uuid.Nil, http.MethodPost, "/api/users", `{"email":"evil@example.com","password":"password123","role":"admin"}`)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
		if len(q.created) != 0 {
			t.Errorf("created %d users, want 0", len(q.created))
		}
	})

	t.Run("non-admin create rejected, creates nothing", func(t *testing.T) {
		h, q, _, userID, _ := newRouter(t)
		rec := doNative(t, h, auth.RoleUser, userID, http.MethodPost, "/api/users", `{"email":"x@example.com","password":"password123","role":"user"}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if len(q.created) != 0 {
			t.Errorf("created %d users, want 0", len(q.created))
		}
	})

	t.Run("admin create with role succeeds", func(t *testing.T) {
		h, q, adminID, _, _ := newRouter(t)
		rec := doNative(t, h, auth.RoleAdmin, adminID, http.MethodPost, "/api/users", `{"email":"new@example.com","password":"password123","role":"user"}`)
		if rec.Code != http.StatusCreated {
			t.Errorf("status = %d, want 201", rec.Code)
		}
		if len(q.created) != 1 || q.created[0].Role != "user" {
			t.Errorf("created = %+v, want one user with role user", q.created)
		}
	})

	t.Run("anonymous list rejected", func(t *testing.T) {
		h, _, _, _, _ := newRouter(t)
		rec := doNative(t, h, "", uuid.Nil, http.MethodGet, "/api/users", "")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
		if body := rec.Body.String(); strings.Contains(body, "@example.com") {
			t.Errorf("rejection body leaks user data: %q", body)
		}
	})

	t.Run("non-admin list rejected", func(t *testing.T) {
		h, _, _, userID, _ := newRouter(t)
		rec := doNative(t, h, auth.RoleUser, userID, http.MethodGet, "/api/users", "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if body := rec.Body.String(); strings.Contains(body, "@example.com") {
			t.Errorf("rejection body leaks user data: %q", body)
		}
	})

	t.Run("admin list succeeds", func(t *testing.T) {
		h, _, adminID, _, _ := newRouter(t)
		if rec := doNative(t, h, auth.RoleAdmin, adminID, http.MethodGet, "/api/users", ""); rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("non-admin delete other rejected, target survives", func(t *testing.T) {
		h, q, _, userID, victimID := newRouter(t)
		rec := doNative(t, h, auth.RoleUser, userID, http.MethodDelete, "/api/users/"+victimID.String(), "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if _, ok := q.users[victimID]; !ok {
			t.Error("victim was deleted, want survivor")
		}
	})

	t.Run("anonymous delete rejected", func(t *testing.T) {
		h, _, _, _, victimID := newRouter(t)
		if rec := doNative(t, h, "", uuid.Nil, http.MethodDelete, "/api/users/"+victimID.String(), ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
	})

	t.Run("admin delete other succeeds", func(t *testing.T) {
		h, q, adminID, _, victimID := newRouter(t)
		rec := doNative(t, h, auth.RoleAdmin, adminID, http.MethodDelete, "/api/users/"+victimID.String(), "")
		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want 204", rec.Code)
		}
		if len(q.deleted) != 1 || q.deleted[0] != victimID {
			t.Errorf("deleted = %v, want [%s]", q.deleted, victimID)
		}
	})

	t.Run("self get still 200", func(t *testing.T) {
		h, _, _, userID, _ := newRouter(t)
		if rec := doNative(t, h, auth.RoleUser, userID, http.MethodGet, "/api/users/"+userID.String(), ""); rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("self update still 200", func(t *testing.T) {
		h, _, _, userID, _ := newRouter(t)
		rec := doNative(t, h, auth.RoleUser, userID, http.MethodPut, "/api/users/"+userID.String(), `{"email":"renamed@example.com"}`)
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("non-admin role escalation still 403", func(t *testing.T) {
		h, q, _, userID, _ := newRouter(t)
		rec := doNative(t, h, auth.RoleUser, userID, http.MethodPut, "/api/users/"+userID.String(), `{"role":"admin"}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if q.users[userID].Role != auth.RoleUser {
			t.Errorf("role = %q, want unchanged user", q.users[userID].Role)
		}
	})
}

func TestNativeServiceRoutesMatrix(t *testing.T) {
	svcID := uuid.New().String()
	routes := []struct{ method, target, body string }{
		{http.MethodPost, "/api/services", `{"name":"x","url":"https://example.com"}`},
		{http.MethodGet, "/api/services/list", ""},
		{http.MethodGet, "/api/services/stats/all", ""},
		{http.MethodGet, "/api/services/" + svcID, ""},
		{http.MethodPut, "/api/services/" + svcID, `{"name":"y"}`},
		{http.MethodDelete, "/api/services/" + svcID, ""},
		{http.MethodGet, "/api/services/" + svcID + "/history", ""},
		{http.MethodGet, "/api/services/" + svcID + "/stats", ""},
	}

	t.Run("anonymous rejected on all eight", func(t *testing.T) {
		h, _, _, _, _ := nativeTestSetup(t)
		for _, rt := range routes {
			if rec := doNative(t, h, "", uuid.Nil, rt.method, rt.target, rt.body); rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s: status = %d, want 401", rt.method, rt.target, rec.Code)
			}
		}
	})

	t.Run("non-admin rejected on all eight", func(t *testing.T) {
		h, _, _, userID, _ := nativeTestSetup(t)
		for _, rt := range routes {
			if rec := doNative(t, h, auth.RoleUser, userID, rt.method, rt.target, rt.body); rec.Code != http.StatusForbidden {
				t.Errorf("%s %s: status = %d, want 403", rt.method, rt.target, rec.Code)
			}
		}
	})

	t.Run("admin passes on all eight", func(t *testing.T) {
		h, _, adminID, _, _ := nativeTestSetup(t)
		for _, rt := range routes {
			rec := doNative(t, h, auth.RoleAdmin, adminID, rt.method, rt.target, rt.body)
			if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
				t.Errorf("%s %s: status = %d, want pass", rt.method, rt.target, rec.Code)
			}
		}
	})
}
