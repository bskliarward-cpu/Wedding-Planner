const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Redirect if already signed in
client.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = 'app.html';
});

const form   = document.getElementById('login-form');
const btn    = document.getElementById('login-btn');
const errMsg = document.getElementById('error-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  errMsg.classList.add('hidden');

  const { error } = await client.auth.signInWithPassword({
    email:    document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
  });

  if (error) {
    errMsg.textContent = error.message;
    errMsg.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Sign in';
  } else {
    window.location.href = 'app.html';
  }
});
