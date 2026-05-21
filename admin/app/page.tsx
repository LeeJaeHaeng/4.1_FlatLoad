import { getStats } from "@/lib/api";

interface StatCardProps {
  title: string;
  value: number;
  icon: string;
  color: string;
  bg: string;
}

function StatCard({ title, value, icon, color, bg }: StatCardProps) {
  return (
    <div
      className="rounded-2xl p-6 flex flex-col gap-4"
      style={{
        background: "#fff",
        boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: "#999" }}>{title}</p>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
          style={{ background: bg }}
        >
          {icon}
        </div>
      </div>
      <p className="text-4xl font-extrabold" style={{ color }}>{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  let stats;
  try {
    stats = await getStats();
  } catch {
    return (
      <div>
        <h1 className="text-2xl font-extrabold mb-2" style={{ color: "#1a1a1a" }}>대시보드</h1>
        <div
          className="rounded-2xl p-5 mt-4"
          style={{ background: "#fff", border: "1px solid #fde8e8" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#e53935" }}>
            ⚠️ 백엔드에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: "#1a1a1a" }}>
          대시보드
        </h1>
        <p className="text-sm mt-1" style={{ color: "#999" }}>FlatRoad 서버 현황 요약</p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        <StatCard
          title="전체 장애물"
          value={stats.totalObstacles}
          icon="🚧"
          color="#4285F4"
          bg="#e8f0fe"
        />
        <StatCard
          title="승인된 장애물"
          value={stats.approvedObstacles}
          icon="✅"
          color="#34A853"
          bg="#e6f4ea"
        />
        <StatCard
          title="미승인 장애물"
          value={stats.pendingObstacles}
          icon="⏳"
          color="#F5A623"
          bg="#fef3e2"
        />
        <StatCard
          title="전체 게시글"
          value={stats.totalPosts}
          icon="📝"
          color="#4285F4"
          bg="#e8f0fe"
        />
        <StatCard
          title="전체 댓글"
          value={stats.totalComments}
          icon="💬"
          color="#555"
          bg="#f5f5f5"
        />
      </div>

      {/* 안내 카드 */}
      <div
        className="mt-6 rounded-2xl p-5 flex items-center gap-4"
        style={{
          background: "#fff",
          boxShadow: "0 1px 6px rgba(0,0,0,0.07)",
        }}
      >
        <div
          className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-xl"
          style={{ background: "#e8f0fe" }}
        >
          ℹ️
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: "#1a1a1a" }}>관리 방법</p>
          <p className="text-xs mt-0.5" style={{ color: "#999" }}>
            왼쪽 메뉴에서 장애물 또는 게시글 관리로 이동해 사진 승인/거부 및 데이터 삭제를 할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
