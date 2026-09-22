const fs = require('fs');
let html = fs.readFileSync('C:/Users/a0988/.openclaw/workspace/hamster-shop/public/admin.html', 'utf8');

// Replace SSE with polling
html = html.replace(
  'let evtSource = null;\n\nlet toastTimer;',
  'let toastTimer;\nlet pollTimer = null;\nlet prevPendingCount = 0;'
);

const sseFunc = `
// ── Polling 即時更新（每 5 秒自動刷新） ──────────────
function startPoll(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch('/api/products');
      if(!r.ok) return;
      const newProducts = await r.json();
      const newPending = newProducts.filter(p=>p.status===STATUS.PENDING);
      const oldPendingIds = products.filter(p=>p.status===STATUS.PENDING).map(p=>p.id);
      const newPendingItems = newPending.filter(p=>!oldPendingIds.includes(p.id));

      if(newPendingItems.length > 0){
        newPendingItems.forEach(item => {
          showNotify('\u{1F514} 有新訂單！商品\u300C' + item.name + '\u300D有顧客付款，待您確認', item.id);
          try {
            var audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleAoKJmKh2c+ZKRMlWLPd27BqFgshZbTi1rNqFhgmZ7ri1bhsFxslar7l17pvFxwpbr/p17pwGBstcMLp17pzGx0xd8Lp17lzGh0xd8Lp17l0Gx4zfcPo17l1HSFCgMfp17l2IiNFhtDo17l3JCREjNTo17l4KCNEjNno17l5KyNFj9zo17l6LiRGkN7o17l7MCVIlt/o17l7MSZJm+Hp17p7MyhKn+Pp17p8NShMounr17p9NyhOouns17p9OCxQl+zv17p9Oi1Sl+3y17p9PC5Tme70+Lp9PTFVm+/19rp9PTNWnO/29rt9PTNWnfD39rt9PTNXnvH49rt9PTNYn/L59rt9PTNZnvP59bt9PTNaoPT59rt9PTNbo/X59rt9PTNco/b59rt9PTNdo/j59rt9PTNdpPn59rt9PTNdpfn6");
            audio.play().catch(function(){});
          } catch(ae){}
          if(Notification.permission==='default') Notification.requestPermission();
          if(Notification.permission==='granted') new Notification('\u{1F439} 新訂單！', {body:item.name+' - NT$ '+item.price, tag:'order'});
        });
      }

      const changed = JSON.stringify(products.map(p=>p.status)) !== JSON.stringify(newProducts.map(p=>p.status));
      if(changed){
        products = newProducts;
        renderTable();
        updateStats();
      }
    } catch(e){ console.warn('poll error', e); }
  }, 5000);
  console.log('[Poll] 已啟動，每 5 秒檢查一次');
}
`;

// Remove old SSE function block
html = html.replace(/\/\/ ── SSE 即時通知 ─[\s\S]*?^\}/m, sseFunc);

// Replace initSSE() call with startPoll()
html = html.replace('initSSE();\n// 請求通知權限', 'startPoll();\n// 請求通知權限');

// Fix eStatus select - add explanation
html = html.replace(
  '<select id="eStatus">\n          <option value="0">上架中</option>\n          <option value="1">暫售（待確認）</option>\n          <option value="2">已完售</option>\n        </select>',
  '<select id="eStatus">\n          <option value="0">上架中</option>\n          <option value="1">暫售（待確認）</option>\n          <option value="2">已完售</option>\n        </select>\n        <div style="font-size:12px;color:var(--sub);margin-top:6px;">上架中=可選購 &nbsp;|&nbsp; 暫售=顧客已付款待確認 &nbsp;|&nbsp; 已完售=最終狀態</div>'
);

// Fix toast labels for 取消
html = html.replace(
  'const labels = { 0:"已重新上架", 1:"已設為待確認", 2:"已設為完售" };',
  'const labels = { 0:"已取消，恢復上架中", 1:"已設為待確認", 2:"已完售" };'
);

fs.writeFileSync('C:/Users/a0988/.openclaw/workspace/hamster-shop/public/admin.html', html);
console.log('done, bytes:', html.length);
